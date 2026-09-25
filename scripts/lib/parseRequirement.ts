/**
 * Recursive-descent parser turning a requirement clause into a RequirementNode.
 *
 * Chosen over a PEG generator because the grammar is small (~a dozen
 * productions) while the input is noisy natural language, so the hard part is
 * not the grammar but degrading gracefully: when a span doesn't parse we emit
 * an `unparsed` node for *that span only* and keep every sibling we understood.
 * That is awkward to express in a generated parser and trivial here.
 *
 * Grammar:
 *   requirement  := disjunction
 *   disjunction  := conjunction ( (OR | SEMI OR) conjunction )*
 *   conjunction  := atom ( (AND | COMMA | SEMI AND) atom )*
 *   atom         := GRADE atom | quantified | either | '(' requirement ')'
 *                 | COURSE | HS_COURSE | condition
 *   quantified   := QUANT courseList
 *   either       := EITHER ( LABEL requirement )+
 *   courseList   := course ( (COMMA | AND) course )*
 */
import type { CourseCode, RequirementNode } from '../../src/lib/types.ts';
import { extractCourseCodes } from './normalizeCode.ts';
import { tokenize, type Token, type TokenType } from './tokenize.ts';

/** Token types that can begin a real requirement rather than free text. */
const STARTS_REQUIREMENT: TokenType[] = [
	'CREDITS',
	'COURSE',
	'HS_COURSE',
	'QUANT',
	'EITHER',
	'GRADE',
	'LPAREN',
	'LABEL'
];

/** Separators that may sit between two adjacent, implicitly conjoined expressions. */
const SEPARATORS: TokenType[] = ['SEMI', 'COMMA', 'AND'];

const CONDITION_RULES: [
	RegExp,
	Extract<RequirementNode, { kind: 'condition' }>['conditionType']
][] = [
	[/\b(permission|consent|approval)\b/i, 'permission'],
	// Checked before standing: "Restricted to students in the B.Kin. program with
	// fourth-year standing" is primarily a program restriction. Requires an actual
	// program keyword, so "Restricted to students with 2nd year standing" still
	// classifies as standing.
	[/\b(program|programme|major|honours|specialization)\b/i, 'program'],
	[/\bstanding\b|\b\d+(st|nd|rd|th)[-\s]year\b/i, 'standing'],
	[/\bcredits?\b/i, 'credits']
];

function classifyCondition(raw: string) {
	for (const [pattern, type] of CONDITION_RULES) {
		if (pattern.test(raw)) return type;
	}
	return 'other' as const;
}

class Parser {
	private pos = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly source: string,
		private readonly nextGroupId: () => string
	) {}

	private peek(offset = 0): Token | undefined {
		return this.tokens[this.pos + offset];
	}

	private is(type: TokenType, offset = 0): boolean {
		return this.peek(offset)?.type === type;
	}

	private startsRequirement(offset = 0): boolean {
		const token = this.peek(offset);
		return token ? STARTS_REQUIREMENT.includes(token.type) : false;
	}

	/** Raw source text spanning a token range, so conditions keep their wording. */
	private slice(fromIndex: number, toIndex: number): string {
		const first = this.tokens[fromIndex];
		const last = this.tokens[toIndex - 1];
		if (!first || !last) return '';
		return this.source.slice(first.start, last.start + last.raw.length).trim();
	}

	/**
	 * Requirements are frequently juxtaposed with no connective at all:
	 * "3 credits from one of WRDS 150, ENGL 100" or "MATH 321. 68% in MATH 321".
	 * Adjacent expressions are therefore conjoined implicitly, which keeps them
	 * structured instead of collapsing the tail into free text.
	 */
	parse(): RequirementNode | null {
		if (this.tokens.length === 0) return null;

		const parts: RequirementNode[] = [];

		while (this.pos < this.tokens.length) {
			while (this.pos < this.tokens.length && SEPARATORS.includes(this.peek()!.type)) this.pos += 1;
			if (this.pos >= this.tokens.length) break;

			const before = this.pos;
			const node = this.parseDisjunction();

			// No progress means the grammar genuinely can't reach this span; keep it
			// verbatim along with any codes inside it rather than dropping it.
			if (this.pos === before) {
				const raw = this.slice(this.pos, this.tokens.length);
				this.pos = this.tokens.length;
				parts.push({ kind: 'unparsed', raw, mentionedCodes: extractCourseCodes(raw) });
				break;
			}

			parts.push(node);
		}

		if (parts.length === 0) return null;
		if (parts.length === 1) return parts[0];
		return { kind: 'all', children: parts };
	}

	private parseDisjunction(): RequirementNode {
		const children = [this.parseConjunction()];

		for (;;) {
			if (this.is('OR')) this.pos += 1;
			else if (this.is('SEMI') && this.is('OR', 1)) this.pos += 2;
			else break;
			children.push(this.parseConjunction());
		}

		if (children.length === 1) return children[0];
		return { kind: 'oneOf', groupId: this.nextGroupId(), children };
	}

	private parseConjunction(): RequirementNode {
		const children = [this.parseAtom()];

		for (;;) {
			if (this.is('AND')) this.pos += 1;
			else if (this.is('SEMI') && this.is('AND', 1)) this.pos += 2;
			else if (this.is('COMMA') && this.startsRequirement(1)) this.pos += 1;
			else if (this.is('COMMA') && this.is('AND', 1)) this.pos += 2;
			else break;
			children.push(this.parseAtom());
		}

		if (children.length === 1) return children[0];
		return { kind: 'all', children };
	}

	private parseAtom(): RequirementNode {
		const token = this.peek();
		if (!token) return { kind: 'unparsed', raw: '', mentionedCodes: [] };

		switch (token.type) {
			case 'GRADE': {
				this.pos += 1;
				// Deliberately a single atom, not a conjunction: "a combined average of
				// 70% in PHRM 211 and PHRM 212, and all of PHRM 271..." would otherwise
				// swallow the trailing requirements. Binding narrowly can understate the
				// grade's scope, but it never loses an edge.
				const child = this.parseAtom();
				return {
					kind: 'withGrade',
					min: token.grade?.min ?? 0,
					unit: token.grade?.unit ?? 'percent',
					child,
					raw: token.raw.trim()
				};
			}

			case 'CREDITS': {
				this.pos += 1;
				const { count, subjects, minLevel } = token.credits!;
				return { kind: 'credits', count, subjects, minLevel, raw: token.raw };
			}

			case 'QUANT':
				return this.parseQuantified();

			case 'EITHER':
				return this.parseEither();

			// "a) All of X, Y or b) SCIE 001" — labelled alternatives without "either".
			case 'LABEL':
				return this.parseLabelled('oneOf');

			case 'LPAREN': {
				this.pos += 1;
				const inner = this.parseDisjunction();
				if (this.is('RPAREN')) this.pos += 1;
				return inner;
			}

			case 'COURSE':
				this.pos += 1;
				return { kind: 'course', code: token.course!.code, raw: token.raw.trim() };

			case 'HS_COURSE':
				this.pos += 1;
				return {
					kind: 'highSchoolCourse',
					name: token.course?.code ?? token.raw.trim(),
					raw: token.raw.trim()
				};

			default:
				return this.parseCondition();
		}
	}

	private parseQuantified(): RequirementNode {
		const quant = this.peek()!;
		this.pos += 1;

		// "All of (a) KIN 110 or HES 120 and (b) KIN 131 or BIOL 131" — the
		// quantifier ranges over labelled groups rather than over bare courses.
		if (this.is('LABEL')) {
			return this.parseLabelled(quant.quantity === 'all' ? 'all' : 'oneOf');
		}

		const children = this.parseCourseList();
		if (children.length === 0) {
			// "One of either BIOL 201 or BIOC 202" — the operand is a nested
			// construct, not a course list. Parse it rather than losing its codes.
			if (this.startsRequirement()) return this.parseAtom();
			return this.parseCondition();
		}
		if (children.length === 1) return children[0];

		if (quant.quantity === 'all') return { kind: 'all', children };
		if (quant.quantity === 1) return { kind: 'oneOf', groupId: this.nextGroupId(), children };
		return { kind: 'nOf', n: Number(quant.quantity), groupId: this.nextGroupId(), children };
	}

	/**
	 * A comma/and separated run of courses. Stops at "and" when a new quantifier
	 * follows, so "All of A, B and one of C, D" binds as AND(all(A,B), oneOf(C,D))
	 * instead of folding "one of C, D" into the first list.
	 */
	private parseCourseList(): RequirementNode[] {
		const items: RequirementNode[] = [];
		// "One of MATH 100, 102, 104" — later entries drop the subject, so carry it.
		let lastSubject: string | null = null;

		const takeCourse = (): boolean => {
			const token = this.peek();
			if (token?.type === 'COURSE') {
				this.pos += 1;
				lastSubject = token.course!.subject;
				items.push({ kind: 'course', code: token.course!.code, raw: token.raw.trim() });
				return true;
			}
			if (token?.type === 'HS_COURSE') {
				this.pos += 1;
				items.push({
					kind: 'highSchoolCourse',
					name: token.course?.code ?? token.raw.trim(),
					raw: token.raw.trim()
				});
				return true;
			}
			if (token?.type === 'NUMBER' && lastSubject && token.raw.replace(/[A-Z]$/, '').length === 3) {
				this.pos += 1;
				items.push({
					kind: 'course',
					code: `${lastSubject} ${token.raw}`,
					raw: token.raw.trim()
				});
				return true;
			}
			return false;
		};

		if (!takeCourse()) return items;

		const continues = (offset: number): boolean =>
			this.is('COURSE', offset) ||
			this.is('HS_COURSE', offset) ||
			(this.is('NUMBER', offset) && lastSubject !== null);

		for (;;) {
			if ((this.is('COMMA') || this.is('AND') || this.is('OR')) && continues(1)) {
				this.pos += 1;
			} else if ((this.is('COMMA') || this.is('SEMI')) && this.is('AND', 1) && continues(2)) {
				this.pos += 2;
			} else if (this.is('COMMA') && this.is('OR', 1) && continues(2)) {
				// Oxford "or" inside a "One of" list is still part of the same list.
				this.pos += 2;
			} else {
				break;
			}
			if (!takeCourse()) break;
		}

		return items;
	}

	/**
	 * "Either (a) X ...; or (b) Y". The labels are the reliable delimiters, so we
	 * slice on them rather than trying to parse the connectives, which are
	 * inconsistent ("; or", " or", ", or").
	 */
	private parseEither(): RequirementNode {
		this.pos += 1; // EITHER
		return this.parseLabelled('oneOf');
	}

	/**
	 * Alternatives delimited by "(a)"/"(b)" labels. The labels are the reliable
	 * delimiter; the connectives around them are not ("; or", " or", ", or",
	 * " and"), so we slice on labels and sub-parse each segment.
	 */
	private parseLabelled(mode: 'oneOf' | 'all'): RequirementNode {
		// A sibling "either" begins a new construct; don't absorb its labels.
		let end = this.pos;
		let depth = 0;
		while (end < this.tokens.length) {
			const type = this.tokens[end].type;
			if (type === 'LPAREN') depth++;
			else if (type === 'RPAREN') {
				if (depth === 0) break;
				depth--;
			} else if (type === 'EITHER' && depth === 0) break;
			end++;
		}
		// Leave the connector that joins us to that sibling for the caller.
		while (end > this.pos && ['AND', 'OR', 'SEMI', 'COMMA'].includes(this.tokens[end - 1].type)) {
			end--;
		}

		const labels: number[] = [];
		depth = 0;
		for (let i = this.pos; i < end; i++) {
			const type = this.tokens[i].type;
			if (type === 'LPAREN') depth++;
			else if (type === 'RPAREN') depth--;
			else if (type === 'LABEL' && depth === 0) labels.push(i);
		}

		// "either A or B" with no (a)/(b) labels is just a disjunction.
		if (labels.length === 0) {
			const node = this.parseDisjunction();
			return node.kind === 'oneOf'
				? node
				: { kind: 'oneOf', groupId: this.nextGroupId(), children: [node] };
		}

		const trimConnectors = (from: number, to: number): number => {
			while (to > from && ['OR', 'SEMI', 'COMMA', 'AND'].includes(this.tokens[to - 1].type)) to--;
			return to;
		};

		// "Either CPSC 340 or all of (a) ... and (b) ..." — the span before the
		// first label is a separate alternative, and a quantifier at the end of it
		// ("all of") governs how the labelled groups combine, rather than being
		// part of that alternative.
		let groupMode = mode;
		let leadTo = trimConnectors(this.pos, labels[0]);
		if (leadTo > this.pos && this.tokens[leadTo - 1].type === 'QUANT') {
			const quantity = this.tokens[leadTo - 1].quantity;
			// "all"/"both" mean every group; a number that happens to equal the group
			// count means the same thing, so treat it as a conjunction either way.
			groupMode = quantity === 'all' || quantity === labels.length ? 'all' : 'oneOf';
			leadTo = trimConnectors(this.pos, leadTo - 1);
		}

		let lead: RequirementNode | null = null;
		if (leadTo > this.pos) {
			lead = new Parser(this.tokens.slice(this.pos, leadTo), this.source, this.nextGroupId).parse();
		}

		const children: RequirementNode[] = [];

		labels.forEach((labelIndex, index) => {
			const from = labelIndex + 1;
			// Drop the trailing "; or" that leads into the next label.
			const to = trimConnectors(from, index + 1 < labels.length ? labels[index + 1] : end);
			if (to <= from) return;

			const sub = new Parser(this.tokens.slice(from, to), this.source, this.nextGroupId);
			const node = sub.parse();
			if (node) children.push(node);
		});

		this.pos = end;

		const combine = (nodes: RequirementNode[]): RequirementNode | null => {
			if (nodes.length === 0) return null;
			if (nodes.length === 1) return nodes[0];
			if (groupMode === 'all') return { kind: 'all', children: nodes };
			return { kind: 'oneOf', groupId: this.nextGroupId(), children: nodes };
		};

		const groups = combine(children);
		if (!groups) return lead ?? { kind: 'unparsed', raw: '', mentionedCodes: [] };
		if (!lead) return groups;

		// The lead and the labelled groups are alternatives of the enclosing "either".
		return { kind: 'oneOf', groupId: this.nextGroupId(), children: [lead, groups] };
	}

	/**
	 * A run of free text. Consumes connectives too ("standing or higher in
	 * Science" is one condition, not a disjunction) but stops at a connective
	 * that introduces a real requirement ("permission of instructor or CPSC 110").
	 */
	private parseCondition(): RequirementNode {
		const start = this.pos;

		while (this.pos < this.tokens.length) {
			if (this.startsRequirement()) break;
			if ((this.is('AND') || this.is('OR') || this.is('COMMA')) && this.startsRequirement(1)) break;
			if (this.is('SEMI')) break;
			this.pos += 1;
		}

		if (this.pos === start) this.pos += 1; // never stall

		const raw = this.slice(start, this.pos);
		return { kind: 'condition', conditionType: classifyCondition(raw), raw };
	}
}

/** Parses one requirement clause. Returns null for empty input; never throws. */
export function parseRequirement(clause: string | null | undefined): RequirementNode | null {
	if (!clause?.trim()) return null;

	const text = clause.trim();
	let counter = 0;
	const nextGroupId = () => `g${counter++}`;

	try {
		const tokens = tokenize(text);
		return new Parser(tokens, text, nextGroupId).parse();
	} catch {
		// The parser is written not to throw, but a clause must never take the
		// whole build down — degrade to the lossless fallback.
		return { kind: 'unparsed', raw: text, mentionedCodes: extractCourseCodes(text) };
	}
}

/** Every course this requirement references, at any depth. */
export function collectCourseCodes(node: RequirementNode | null): CourseCode[] {
	if (!node) return [];
	const found = new Set<CourseCode>();

	const walk = (current: RequirementNode): void => {
		switch (current.kind) {
			case 'course':
				found.add(current.code);
				break;
			case 'unparsed':
				current.mentionedCodes.forEach((code) => found.add(code));
				break;
			case 'withGrade':
				walk(current.child);
				break;
			case 'all':
			case 'oneOf':
			case 'nOf':
				current.children.forEach(walk);
				break;
		}
	};

	walk(node);
	return [...found];
}

/** True if any part of the tree fell back to free text — drives the coverage report. */
export function hasUnparsed(node: RequirementNode | null): boolean {
	if (!node) return false;
	switch (node.kind) {
		case 'unparsed':
			return true;
		case 'withGrade':
			return hasUnparsed(node.child);
		case 'all':
		case 'oneOf':
		case 'nOf':
			return node.children.some(hasUnparsed);
		default:
			return false;
	}
}
