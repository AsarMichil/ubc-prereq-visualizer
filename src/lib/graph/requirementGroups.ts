/**
 * Turns a requirement tree into the flat list of decisions a person actually
 * faces when expanding a course backward.
 *
 * The AST is a boolean formula, but nesting is shallow in practice (max depth 4
 * across the corpus) and the dominant shape is `all(oneOf(...), oneOf(...), X)`.
 * Rendered literally that reads as "One of / One of / All of", which says
 * nothing about what you need. Flattened, it reads as a short list of rows:
 * some required outright, others "pick at least one".
 */
import type { CourseCode, RequirementNode } from '../types';

export type OptionNode =
	| { kind: 'course'; code: CourseCode; label: string; otherCampus: boolean }
	/** A BC secondary-school course; it can never be expanded further. */
	| { kind: 'highSchool'; label: string }
	/** A non-course requirement (standing, permission); shown but not selectable. */
	| { kind: 'condition'; label: string }
	/** A nested compound, e.g. "(a) BIOL 200 and one of BIOL 233, BIOL 234". */
	| { kind: 'compound'; label: string; courses: CourseCode[]; group: RequirementGroup };

export interface RequirementGroup {
	id: string;
	/** `required` must all be taken; `choose` needs at least `n`. */
	kind: 'required' | 'choose';
	/** Minimum selections for a `choose` group. */
	n: number;
	options: OptionNode[];
}

function labelOf(node: RequirementNode): string {
	switch (node.kind) {
		case 'course':
			return node.code;
		case 'highSchoolCourse':
			return node.name;
		case 'condition':
			return node.raw;
		case 'unparsed':
			return node.raw;
		case 'withGrade':
			return `${labelOf(node.child)} (min ${node.min}%)`;
		case 'all':
			return node.children.map(labelOf).join(' + ');
		case 'oneOf':
			return node.children.map(labelOf).join(' or ');
		case 'nOf':
			return `${node.n} of ${node.children.map(labelOf).join(', ')}`;
	}
}

/** Every course mentioned anywhere beneath a node. */
function coursesIn(node: RequirementNode): CourseCode[] {
	const found: CourseCode[] = [];
	const walk = (current: RequirementNode): void => {
		switch (current.kind) {
			case 'course':
				found.push(current.code);
				break;
			case 'unparsed':
				found.push(...current.mentionedCodes);
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
	return [...new Set(found)];
}

/** Strips a grade wrapper so the underlying course is still selectable. */
function unwrap(node: RequirementNode): RequirementNode {
	return node.kind === 'withGrade' ? unwrap(node.child) : node;
}

function toOption(node: RequirementNode, idPrefix: string, index: number): OptionNode {
	const label = labelOf(node);
	const inner = unwrap(node);

	switch (inner.kind) {
		case 'course':
			// "_O" survives normalization precisely so Okanagan courses stay
			// distinct from their Vancouver namesakes; surface that here.
			return { kind: 'course', code: inner.code, label, otherCampus: /_O\s/.test(inner.code) };
		case 'highSchoolCourse':
			return { kind: 'highSchool', label };
		case 'condition':
		case 'unparsed':
			return { kind: 'condition', label };
		default:
			return {
				kind: 'compound',
				label,
				courses: coursesIn(inner),
				group: toGroup(inner, `${idPrefix}.${index}`)
			};
	}
}

function toGroup(node: RequirementNode, id: string): RequirementGroup {
	const inner = unwrap(node);

	if (inner.kind === 'oneOf' || inner.kind === 'nOf') {
		return {
			id,
			kind: 'choose',
			n: inner.kind === 'nOf' ? inner.n : 1,
			options: inner.children.map((child, index) => toOption(child, id, index))
		};
	}

	if (inner.kind === 'all') {
		return {
			id,
			kind: 'required',
			n: inner.children.length,
			options: inner.children.map((child, index) => toOption(child, id, index))
		};
	}

	return { id, kind: 'required', n: 1, options: [toOption(node, id, 0)] };
}

/**
 * Splits a requirement into the rows shown when expanding a course backward.
 *
 * A top-level `all` becomes one row per child, because those are independent
 * decisions. Anything else is a single row.
 */
export function requirementGroups(node: RequirementNode | null): RequirementGroup[] {
	if (!node) return [];

	if (unwrap(node).kind === 'all') {
		const all = unwrap(node) as Extract<RequirementNode, { kind: 'all' }>;
		return all.children.map((child, index) => toGroup(child, `g${index}`));
	}
	// Pass the original node, not the unwrapped one: a top-level grade wrapper
	// carries the threshold ("68% in MATH 226"), and stripping it here would
	// silently drop the part that makes the requirement real.
	return [toGroup(node, 'g0')];
}

/**
 * Courses needed no matter which options are chosen: everything that appears in
 * a `required` row with a single course option.
 */
export function alwaysRequired(groups: RequirementGroup[]): CourseCode[] {
	const found: CourseCode[] = [];
	for (const group of groups) {
		if (group.kind !== 'required') continue;
		for (const option of group.options) {
			if (option.kind === 'course') found.push(option.code);
		}
	}
	return [...new Set(found)];
}

/** True once a group's selection satisfies it. */
export function groupSatisfied(group: RequirementGroup, selected: Set<string>): boolean {
	const selectable = group.options.filter(
		(option) => option.kind === 'course' || option.kind === 'compound'
	);
	if (selectable.length === 0) return true; // conditions only; nothing to pick

	const chosen = selectable.filter((option) =>
		option.kind === 'course'
			? selected.has(option.code)
			: // A compound counts only when its own structure is satisfied. Treating
				// "any course inside it" as enough would mark "AI 240 and one of six"
				// complete after a single tick on one of the six.
				groupSatisfied(option.group, selected)
	).length;

	return group.kind === 'required' ? chosen === selectable.length : chosen >= group.n;
}

export interface DisplayGroup extends RequirementGroup {
	/** Options still worth showing, after dropping what can't or needn't be picked. */
	visible: OptionNode[];
	/** Courses already drawn that satisfy this row. */
	satisfiedBy: CourseCode[];
	/**
	 * True when every course option was filtered out and the row is still unmet -
	 * rare (2 rows in the whole calendar), but rendering nothing there would
	 * silently imply the course has no requirement.
	 */
	unavailable: boolean;
}

/**
 * Removes course-code tokens from a label, leaving the surrounding prose. Used
 * when an option's courses are all unusable but its wording still states a real
 * requirement.
 */
function stripCodes(label: string): string {
	const MARK = '\u0000';

	const cleaned = label
		// Mark the codes, then collapse runs of them along with the connectives
		// that only existed to join them. Removing every "or" outright would turn
		// "from MATH_V or STAT_V" into "from MATH_V STAT_V".
		.replace(/\b[A-Z]{2,5}(?:_[VO])?\s*\d{1,3}[A-Z]?\b/g, MARK)
		.replace(new RegExp(`${MARK}(?:\\s*(?:,|\\+|or|and)\\s*${MARK})*`, 'gi'), MARK)
		.replace(new RegExp(`\\s*(?:,|\\+|or|and)?\\s*${MARK}`, 'gi'), '')
		.replace(/\s*[,+]\s*$/, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

	// A remnant like "credit exclusion:" states nothing; only keep real wording.
	const words = cleaned
		.replace(/[:;,.]+$/, '')
		.split(/\s+/)
		.filter(Boolean);
	return words.length >= 3 ? cleaned.replace(/[:;,]+$/, '') : '';
}

/** Courses an option contributes, ignoring non-course options. */
function optionCourses(option: OptionNode): CourseCode[] {
	if (option.kind === 'course') return [option.code];
	if (option.kind === 'compound') return option.courses;
	return [];
}

/**
 * Prepares requirement rows for display by *removing* options rather than
 * greying them out: anything already drawn, and anything that cannot be taken
 * here at all (Okanagan courses). Hiding beats disabling because the whole
 * point of the builder is that only what you chose stays on screen.
 */
export function displayGroups(
	groups: RequirementGroup[],
	alreadyDrawn: ReadonlySet<string>
): DisplayGroup[] {
	return groups.map((group) => {
		const satisfiedBy: CourseCode[] = [];
		const visible: OptionNode[] = [];
		let hadCourseOption = false;

		for (const option of group.options) {
			const courses = optionCourses(option);

			if (courses.length === 0) {
				// Conditions and high-school courses carry real information and are
				// never selectable, so they always stay.
				visible.push(option);
				continue;
			}

			hadCourseOption = true;

			// Okanagan courses are not offered here; they can never be chosen.
			if (option.kind === 'course' && option.otherCampus) continue;

			// A compound whose every course is Okanagan still often carries real
			// prose - CPSC 320's reads "at least 3 credits from MATH_V or STAT_V at
			// 200 level or above or MATH_O 200, ...". Dropping it outright would
			// delete a genuine requirement along with the unusable codes, so keep
			// the prose and strip only the codes.
			if (option.kind === 'compound' && courses.every((code) => /_O\s/.test(code))) {
				const prose = stripCodes(option.label);
				if (prose) visible.push({ kind: 'condition', label: prose });
				continue;
			}

			const drawn = courses.filter((code) => alreadyDrawn.has(code));
			if (drawn.length === courses.length) {
				satisfiedBy.push(...drawn);
				continue;
			}

			visible.push(option);
		}

		return {
			...group,
			visible,
			satisfiedBy: [...new Set(satisfiedBy)],
			// Only flag a row when it would otherwise render completely blank. A row
			// left with explanatory prose is still telling the reader something.
			unavailable: hadCourseOption && visible.length === 0 && satisfiedBy.length === 0
		};
	});
}
