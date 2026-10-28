import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// This fork's job search and resume work, end to end against the fake
// sources and AI: two sources searched at once with list pages left out and
// postings ranked by relevance; a one-page resume made by leaving out what's
// least relevant, counted in the real PDF, with its contact links intact;
// and the draft kept, with what's known about the job, after a reload.
test.beforeAll(async () => {
  await resetData();
  // A candidate in India, so eligibility for India counts.
  await sql(`UPDATE "ProfileField" SET value = 'India' WHERE key = 'country'`);
  await sql(`UPDATE "ProfileField" SET value = 'Bengaluru' WHERE key = 'city'`);
});

/** Pages in a PDF, as the app counts them (src/lib/pdf/pages.ts): page objects, not the page tree. */
const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

test("searches every source with a key, leaves out list pages and ranks by relevance", async ({ page }) => {
  // A Firecrawl key besides the environment's JSearch key; JSearch stays the chosen source.
  await page.goto("/settings?section=jobs");
  await page.getByRole("radio", { name: "Firecrawl" }).click();
  const key = page.getByLabel("API key");
  await key.fill("e2e-firecrawl-key");
  await key.blur();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.getByRole("radio", { name: "JSearch" }).click();
  await expect(page.getByRole("radio", { name: "Every source with a key" })).toBeChecked();

  await page.goto("/jobs");
  const form = page.getByRole("search", { name: "Search postings" });
  await form.getByLabel("What").fill("Senior Product Designer");
  await form.getByLabel("Where").fill("Bengaluru");
  await form.getByLabel("Country").selectOption("in");
  await form.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/jobs\?search=c/);

  // Both sources were asked, and the report says what Firecrawl left out.
  const report = page.locator("details").filter({ hasText: "JSearch searched" });
  await expect(report.locator("summary")).toHaveText(/JSearch searched \(3\) · Firecrawl searched \(\d+\)/);
  await report.locator("summary").click();
  await expect(report).toContainText(/Left out \d+ pages that list many jobs rather than one posting/);

  const list = page.getByRole("list", { name: "Postings" });
  // The employer's own posting open to India is first, with its facts.
  const chaipay = list.getByRole("button", { name: /^Senior Product Designer \(India\)/ });
  await expect(list.getByRole("listitem").first()).toContainText("Senior Product Designer (India)");
  await expect(chaipay).toContainText("Direct apply");
  await expect(chaipay).toContainText("₹45–60 LPA (stated)");
  await expect(chaipay).toContainText("India");
  // The list page never shows; the US-only remote posting is left out until asked for.
  await expect(list).not.toContainText("2,000+");
  await expect(list).not.toContainText("Stateside Pay");
  await page.getByRole("button", { name: /left out as not eligible or unrelated/ }).click();
  await expect(list).toContainText("Senior Product Designer - Remote - US");

  // Why it ranks where it does.
  await chaipay.click();
  const relevance = page.getByRole("region", { name: /Relevance to your resume/ });
  await expect(relevance.getByRole("list", { name: "Why it's relevant" })).toContainText("Apply link goes to the employer (Lever)");
});

test("writes a one-page resume by leaving out what's least relevant, measured in the real PDF, with links kept", async ({ page }) => {
  // Enough bullets in the current role, most of them nothing to do with the posting, to run over a page.
  const [current] = await sql<{ id: string; bullets: string }>(`SELECT id, bullets FROM "Experience" WHERE current ORDER BY "startYear" DESC LIMIT 1`);
  const filler = Array.from(
    { length: 14 },
    (_, index) => `Organised the quarterly office event number ${index + 1}, booking venues, catering and transport for forty colleagues across two floors`,
  );
  await sql(`UPDATE "Experience" SET bullets = $1 WHERE id = $2`, [[current.bullets, ...filler].join("\n"), current.id]);

  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill(`Ledgerly: Senior Product Designer, Payments
Amsterdam (hybrid) · €75,000–€90,000

What we're looking for
- 5+ years of product design
- You've built or maintained a design system
- Strong prototyping skills in Figma`);
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await expect(page.getByRole("heading", { name: "How you match" })).toBeVisible();
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 60_000 });
  const id = new URL(page.url()).pathname.split("/").at(-1)!;

  // What was left out, to put back: the summary first, then the least relevant bullets.
  const notice = page.getByRole("note").filter({ hasText: "Left out to fit the page limit:" });
  await expect(notice).toContainText("Summary");
  await expect(notice).toContainText(/\d+ bullets? from the .* role/);

  // The real PDF: one page, contact details still links.
  const pdf = (await (await page.request.get(`/api/pdf?doc=resume&application=${id}`)).body()).toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pageCount(pdf)).toBe(1);
  expect(pdf).toMatch(/\/URI\s*\(mailto:/);
  expect(pdf).toMatch(/\/URI\s*\(https?:\/\//);

  // Every cut was a whole irrelevant bullet: what's kept is word for word, and the relevant first bullet stayed.
  const [resume] = await sql<{ units: { id: string; text: string }[] }>(`SELECT units FROM "Document" WHERE "applicationId" = $1 AND kind = 'RESUME'`, [id]);
  const role = resume.units.find((unit) => unit.id === `experience:${current.id}`)!;
  expect(role.text.split("\n")[0]).toBe(current.bullets.split("\n")[0]);
  for (const line of role.text.split("\n").slice(1)) expect([...current.bullets.split("\n"), ...filler]).toContain(line);
  expect(resume.units.some((unit) => unit.id === "summary")).toBe(false);
  // Every role is still there.
  const roles = await sql<{ id: string }>(`SELECT id FROM "Experience"`);
  for (const { id: roleId } of roles) expect(resume.units.some((unit) => unit.id === `experience:${roleId}`)).toBe(true);

  // The draft survives a reload, with what's known about the job.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Senior Product Designer, Payments/ })).toBeVisible();
  await page.getByRole("tab", { name: /Job posting/ }).click();
  const about = page.getByRole("region", { name: /About this job/ });
  await expect(about).toContainText("Pasted by you");
  await expect(about).toContainText(/Relevance \d+ of 100/);
  const [{ status }] = await sql<{ status: string }>(`SELECT status FROM "Application" WHERE id = $1`, [id]);
  expect(status).toBe("DRAFT");
});
