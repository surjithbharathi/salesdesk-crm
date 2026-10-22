// RFC 4180-style parser. Quoted fields retain commas, newlines and escaped quotes.
export function parseLeadCsv(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > 1024 * 1024)
    throw new Error("CSV must be text no larger than 1 MiB.");
  source = source.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const finishField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    if (rows.length > 501) throw new Error("Import at most 500 leads at a time.");
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === ",") finishField();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      finishRow();
    } else if (c === '"') {
      if (field || closed) throw new Error("Unexpected quote in CSV field.");
      quoted = true;
    } else {
      if (closed) {
        if (!/\s/.test(c)) throw new Error("Unexpected text after quoted field.");
      } else field += c;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (field || row.length || closed) finishRow();
  if (rows.length < 2) throw new Error("CSV needs a header and at least one lead.");
  const aliases = {
    name: "name",
    leadname: "name",
    contactname: "name",
    fullname: "name",
    company: "company",
    business: "company",
    companyname: "company",
    phone: "phone",
    mobile: "phone",
    phonenumber: "phone",
    mobilenumber: "phone",
    email: "email",
    emailaddress: "email",
    city: "city",
    source: "source",
    leadsource: "source",
    value: "value",
    dealvalue: "value",
    estimatedvalue: "value",
    stage: "stage",
    leadstage: "stage",
  };
  const headers = rows.shift().map((h) => aliases[h.toLowerCase().replace(/[^a-z]/g, "")] || null);
  if (!headers.includes("name")) throw new Error("CSV must contain a Name or Lead Name column.");
  const recognized = headers.filter(Boolean);
  if (new Set(recognized).size !== recognized.length)
    throw new Error("CSV contains duplicate mapped columns.");
  return rows.map((columns, index) => {
    if (columns.length !== headers.length)
      throw new Error(`Row ${index + 2} has a different column count.`);
    const record = {};
    headers.forEach((key, n) => {
      if (key && columns[n].trim()) record[key] = columns[n].trim();
    });
    if (!record.name) throw new Error(`Row ${index + 2} has no lead name.`);
    if ("value" in record) {
      const value = record.value.replace(/[₹, ]/g, "");
      if (!/^\d+(?:\.\d{1,2})?$/.test(value))
        throw new Error(`Row ${index + 2} has an invalid value.`);
      record.value = Number(value);
    }
    return record;
  });
}
