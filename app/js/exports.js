const INDEMNITY_COLUMNS = [
  "Name",
  "Email",
  "Status",
  "Role",
  "Phone",
  "Emergency name",
  "Emergency relationship",
  "Emergency phone",
  "Indemnity status",
  "Signature",
  "Signed date",
  "Form version",
  "Accepted at",
];

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function buildIndemnityCsv(records = []) {
  const rows = records.map((record) => [
    record.fullName,
    record.email,
    record.status,
    record.role,
    record.phone,
    record.emergencyName,
    record.emergencyRelationship,
    record.emergencyPhone,
    record.indemnityStatus,
    record.indemnitySignature,
    record.indemnitySignedAt,
    record.indemnityFormVersion,
    record.indemnityAcceptedAt,
  ]);
  return `\uFEFF${INDEMNITY_COLUMNS.join(",")}\r\n${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
