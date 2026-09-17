/** A normalized UBC course code: campus suffix stripped, single space. e.g. "CPSC 110". */
export type CourseCode = string;

/**
 * A parsed requirement expression.
 *
 * UBC states requirements as prose ("One of BIOL 233, BIOL 234"), which is a
 * logic tree, not a list of edges. Flattening it would make the graph claim
 * that alternatives are all mandatory, so we keep the tree and derive edges
 * from it.
 */
export type RequirementNode =
	| { kind: 'course'; code: CourseCode; raw: string }
	/** A BC secondary-school course (`BIOL 11`, `Pre-calculus 12`). Never resolves to a node. */
	| { kind: 'highSchoolCourse'; name: string; raw: string }
	| { kind: 'all'; children: RequirementNode[] }
	| { kind: 'oneOf'; groupId: string; children: RequirementNode[] }
	| { kind: 'nOf'; n: number; groupId: string; children: RequirementNode[] }
	/** "a score of 68% or higher in MATH 321" — a threshold bound to a specific course. */
	| {
			kind: 'withGrade';
			min: number;
			unit: 'percent' | 'grade';
			child: RequirementNode;
			raw: string;
	  }
	/** A requirement that isn't a course at all; preserved verbatim for display. */
	| {
			kind: 'condition';
			conditionType: 'standing' | 'program' | 'permission' | 'credits' | 'other';
			raw: string;
	  }
	/**
	 * Lossless fallback. Keeps the original text *and* any bare course codes found
	 * in it, so a clause we can't structure still contributes edges to the graph
	 * rather than disappearing.
	 */
	| { kind: 'unparsed'; raw: string; mentionedCodes: CourseCode[] };

export type RequirementKind = RequirementNode['kind'];

/** The named sections carved out of a single `field_course_description` string. */
export interface CourseSections {
	/** Description prose with the hours vector and every requirement clause removed. */
	descriptionText: string;
	/** The `[3-2-1]` lecture-lab-tutorial vector, without brackets, if present. */
	hoursVector: string | null;
	prerequisiteText: string | null;
	corequisiteText: string | null;
	equivalencyText: string | null;
	creditExclusionText: string | null;
	/** Sentences that sit inside a requirement clause but aren't requirements. */
	notes: string[];
}

export interface CreditRange {
	min: number;
	max: number;
}

export interface Subject {
	/** Subject code with the campus suffix stripped, e.g. "CPSC". */
	code: string;
	/** Human-readable name from `field_tax_subject_title`, e.g. "Computer Science". */
	title: string;
	faculty: string | null;
	department: string | null;
	school: string | null;
}

export interface Course {
	code: CourseCode;
	subject: string;
	number: number;
	/** Course numbers can carry a letter suffix (`101A`); `number` drops it. */
	numberLabel: string;
	title: string;
	credits: CreditRange;
	sections: CourseSections;
	prerequisite: RequirementNode | null;
	corequisite: RequirementNode | null;
	equivalentTo: CourseCode[];
	creditExcludedWith: CourseCode[];
	url: string;
}
