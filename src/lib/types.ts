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
	/**
	 * "at least 3 credits from MATH or STAT at 200 level or above" - a quantity
	 * drawn from a set defined by subject and level, not a list of courses.
	 *
	 * Distinct from `condition` because it is checkable: given what a student has,
	 * you can add up the matching credits. 23 clauses state requirements this way.
	 */
	| {
			kind: 'credits';
			count: number;
			/** Subjects the credits may come from, campus suffix stripped. */
			subjects: string[];
			/** Lowest course number that counts, e.g. 200. Null when unstated. */
			minLevel: number | null;
			raw: string;
	  }
	/**
	 * "any course on the STAT 200 credit exclusion list" - satisfied by the named
	 * course or by anything UBC deems equivalent to it.
	 *
	 * The list itself lives on a page the calendar links to and the scrape cannot
	 * follow, so the members are unknown. The named course is kept as a real
	 * reference because a course is always on its own exclusion list.
	 */
	| { kind: 'creditExclusion'; code: CourseCode; raw: string }
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
