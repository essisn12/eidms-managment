// Tables exposed through the generic master-data manager (also the API whitelist).
export type MasterTable = { key: string; label: string; group: string };

export const MASTER_TABLES: MasterTable[] = [
  { key: "NSIDB_DIVISION", label: "Division", group: "Geography" },
  { key: "NSIDB_DISTRICT", label: "District", group: "Geography" },
  { key: "NSIDB_THANA", label: "Thana", group: "Geography" },
  { key: "NSIDB_UNION", label: "Union", group: "Geography" },
  { key: "NSIDB_POST_OFFICE", label: "Post Office", group: "Geography" },
  { key: "NSIDB_COUNTRY", label: "Country", group: "Geography" },
  { key: "NSIDB_NATIONALITY", label: "Nationality", group: "Person" },
  { key: "NSIDB_GENDER", label: "Gender", group: "Person" },
  { key: "NSIDB_RELIGION", label: "Religion", group: "Person" },
  { key: "NSIDB_MARRITAL_STATUS", label: "Marital Status", group: "Person" },
  { key: "NSIDB_PROFESSION", label: "Profession", group: "Person" },
  { key: "NSIDB_DESIGNATION", label: "Designation", group: "Person" },
  { key: "NSIDB_PERSON_TYPE", label: "Person Type", group: "Person" },
  { key: "NSIDB_BOARD_UNIVERSITY", label: "Board / University", group: "Education" },
  { key: "NSIDB_EXAM_DEGREE", label: "Exam / Degree", group: "Education" },
  { key: "NSIDB_SUBJECT", label: "Subject", group: "Education" },
  { key: "NSIDB_MINISTRY", label: "Ministry", group: "Organization" },
  { key: "NSIDB_ORGANIZATION", label: "Organization", group: "Organization" },
  { key: "NSIDB_BRANCH", label: "Branch", group: "Organization" },
  { key: "NSIDB_WING", label: "Wing", group: "Organization" },
  { key: "NSIDB_SECTION", label: "Section", group: "Organization" },
  { key: "NSIDB_INVESTIGATION_TYPE", label: "Investigation Type", group: "Investigation" },
  { key: "NSIDB_PRIORITY", label: "Priority", group: "Investigation" },
  { key: "NSIDB_COMMON_CODE", label: "Common Code", group: "System" },
  { key: "NSIDB_CALENDAR_TYPE", label: "Calendar Type", group: "System" },
  { key: "NSIDB_HOLIDAYTYPE", label: "Holiday Type", group: "System" },
  { key: "NSIDB_HOLIDAY", label: "Holiday", group: "System" },
  { key: "NSIDB_WORKING_DAYS", label: "Working Days", group: "System" },
];

export const isMasterTable = (key: string) => MASTER_TABLES.some((t) => t.key === key.toUpperCase());
