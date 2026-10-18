// Parses the Oracle DDL dumps (../dbscemaeidms.sql, ../ums.sql) into lib/schema.generated.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["../dbscemaeidms.sql", "../ums.sql"].map((f) => path.resolve(root, f));

const tables = {};
for (const file of files) {
  const sql = fs.readFileSync(file, "utf8");
  const re = /CREATE TABLE\s+(\w+)\.(\w+)\s*\(\s*\n([\s\S]*?)\n\)\s*\n/g;
  let m;
  while ((m = re.exec(sql))) {
    const [, owner, name, body] = m;
    const columns = [];
    for (const line of body.split("\n")) {
      const c = line.match(/^\s{2}(\w+)\s+([A-Z0-9]+)(?:\(([^)]*)\))?\s*(.*?),?\s*$/);
      if (!c) continue;
      const [, col, type, size, rest] = c;
      columns.push({
        name: col,
        type: type.replace(/\d+$/, (d) => (type.startsWith("VARCHAR") || type.startsWith("NVARCHAR") ? d : d)),
        size: size ? size.replace(/\s*(BYTE|CHAR)/, "").trim() : null,
        nullable: !/NOT NULL/.test(rest),
        default: (rest.match(/DEFAULT\s+('[^']*'|\S+)/) || [])[1] ?? null,
      });
    }
    tables[`${owner}.${name}`] = { owner, name, columns };
  }
}

const out = path.join(root, "lib", "schema.generated.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(tables, null, 1));
console.log(`Parsed ${Object.keys(tables).length} tables -> ${path.relative(root, out)}`);
