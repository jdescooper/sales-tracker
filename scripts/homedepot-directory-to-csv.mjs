#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const DIRECTORY_URL = "https://www.homedepot.com/l/storeDirectory";
const DEFAULT_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY"
];

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  const states = (args.states || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const targetStates = states.length ? states : DEFAULT_STATES;
  const rows = [];

  for (const state of targetStates) {
    const url = state === "DC" ? "https://www.homedepot.com/l/DC" : `https://www.homedepot.com/l/${state}`;
    console.error(`Fetching ${state}...`);
    const html = await fetchText(url);
    rows.push(...parseStatePage(html, url));
    await delay(Number(args.delay || 700));
  }

  const csv = toCsv(dedupeByStoreNumber(rows));
  if (args.out) {
    await writeFile(args.out, csv, "utf8");
    console.error(`Wrote ${args.out}`);
  } else {
    process.stdout.write(csv);
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 CIS store directory export"
    }
  });
  const text = await response.text();
  if (!response.ok || /Oops!! Something went wrong/i.test(text)) {
    throw new Error(`Home Depot blocked or failed the directory request for ${url}. Open the page in a browser and use the app's admin CSV import instead.`);
  }
  return text;
}

function parseStatePage(html) {
  const linkRegex = /href=["']([^"']*\/l\/[^"']+?\/[A-Z]{2}\/[^"']+?\/\d{5}(?:-\d{4})?\/\d+)(?:[?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [];
  let match = linkRegex.exec(html);
  while (match) {
    const sourceUrl = cleanStoreUrl(match[1]);
    const sourceData = parseStoreUrl(sourceUrl);
    if (sourceData.store_number && !matches.some((item) => item.store_number === sourceData.store_number)) {
      matches.push({
        ...sourceData,
        index: match.index,
        name: htmlToLines(match[2])[0] || sourceData.name,
        source_url: sourceUrl
      });
    }
    match = linkRegex.exec(html);
  }

  return matches.map((item, index) => {
    const block = html.slice(item.index, matches[index + 1]?.index || html.length);
    const details = extractDetails(block, item.name);
    return {
      store_number: item.store_number,
      name: item.name,
      street: details.street,
      city: details.city || item.city,
      state: details.state || item.state,
      zip: details.zip || item.zip,
      phone: details.phone,
      source_url: item.source_url,
      retailer: "Home Depot"
    };
  });
}

function parseStoreUrl(url) {
  const match = url.match(/\/l\/([^/?#]+)\/([a-z]{2})\/([^/?#]+)\/(\d{5}(?:-\d{4})?)\/(\d+)/i);
  if (!match) return {};
  return {
    name: titleFromSlug(match[1]),
    state: match[2].toUpperCase(),
    city: titleFromSlug(match[3]),
    zip: match[4].slice(0, 5),
    store_number: match[5]
  };
}

function extractDetails(block, title) {
  const titleText = normalizeSpaces(title).toLowerCase();
  const lines = htmlToLines(block).filter((line) => {
    const lower = line.toLowerCase();
    if (lower === titleText) return false;
    return !/( rentals| home services| garden center| pro desk)$/.test(lower);
  });
  const cityLine = lines.map(parseCityStateZip).find(Boolean);
  const phone = lines.map(parsePhone).find(Boolean) || "";
  const street = lines.find((line) => {
    if (!/\d/.test(line)) return false;
    if (parseCityStateZip(line) || parsePhone(line)) return false;
    return !/^#?\d+$/.test(line);
  }) || "";

  return {
    street,
    city: cityLine?.city || "",
    state: cityLine?.state || "",
    zip: cityLine?.zip || "",
    phone
  };
}

function htmlToLines(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(a|div|h[1-6]|li|p|span)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map(normalizeSpaces)
    .filter(Boolean);
}

function parseCityStateZip(line) {
  const match = normalizeSpaces(line).match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!match) return null;
  return { city: match[1], state: match[2], zip: match[3].slice(0, 5) };
}

function parsePhone(line) {
  const match = normalizeSpaces(line).match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (!match) return "";
  const digits = match[0].replace(/\D/g, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : match[0];
}

function cleanStoreUrl(value) {
  const raw = String(value || "").trim().replace(/&amp;/g, "&").replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.homedepot.com${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function dedupeByStoreNumber(rows) {
  return Array.from(new Map(rows.map((row) => [row.store_number, row])).values());
}

function toCsv(rows) {
  const headers = ["store_number", "name", "street", "city", "state", "zip", "phone", "source_url", "retailer"];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => quoteCsv(row[header])).join(","))
  ].join("\n");
}

function quoteCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function titleFromSlug(value) {
  const text = decodeURIComponent(String(value || ""))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\bDc\b/g, "DC");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseArgs(rawArgs) {
  return rawArgs.reduce((parsed, item) => {
    const match = item.match(/^--([^=]+)=(.*)$/);
    if (match) parsed[match[1]] = match[2];
    return parsed;
  }, {});
}
