"""Signs in to the web app as each persona and takes the blog's screenshots.

    uv run --with playwright python development/kestrel-finch/clients/ui_tour.py [step …]

Screenshots go to development/kestrel-finch/.runs/shots/. Steps print what each
page showed, so a missing element is a finding, not a silent pass.
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

WEB = __import__("os").environ.get("KF_WEB", "http://mac.local:3000")
WS = "kestrel-finch"
PASSWORD = "Kestrel-Demo-2026"
SHOTS = Path(__file__).resolve().parent.parent / ".runs" / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)
K = "kestrel_crm_hubspot_sync.crm"


def sign_in(page: Page, user: str) -> None:
    page.goto(f"{WEB}/{WS}")
    page.wait_for_load_state("networkidle")
    if page.locator("#username").count() == 0:
        page.get_by_text("Sign in", exact=True).first.click()
        page.wait_for_selector("#username", timeout=30000)
    page.fill("#username", user)
    if page.locator("#password").count() == 0:  # username first, then password
        page.click("#kc-login")
        page.wait_for_selector("#password", timeout=30000)
    page.fill("#password", PASSWORD)
    page.click("#kc-login")
    page.wait_for_url(f"{WEB}/**", timeout=60000)
    page.wait_for_load_state("networkidle")
    print(f"[{user}] signed in: {page.url}")


def shot(page: Page, name: str) -> None:
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path), full_page=False)
    print(f"   shot {path.name}")


def run_sql(page: Page, sql: str) -> None:
    editor = page.locator(".monaco-editor").first
    editor.click()
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.press("Delete")
    page.keyboard.insert_text(sql)
    page.get_by_role("button", name="Run").first.click()
    page.wait_for_timeout(1500)
    # Until the run settles (DONE or an error), at most a minute.
    for _ in range(60):
        if "RUNNING" not in page.inner_text("body"):
            break
        page.wait_for_timeout(1000)
    page.wait_for_timeout(1000)


def text_of(page: Page, needle: str) -> str:
    body = page.inner_text("body")
    i = body.find(needle)
    return body[i: i + 300].replace("\n", " | ") if i >= 0 else f"(no '{needle}' on the page)"


def marketing(page: Page) -> None:
    sign_in(page, "amelie.fontaine")
    page.goto(f"{WEB}/{WS}/query")
    page.wait_for_load_state("networkidle")
    run_sql(page, f"SELECT first_name, email, phone, birth_date, region, marketing_opt_in\nFROM {K}.contacts\nLIMIT 50")
    print("   ", text_of(page, "Masked for you"))
    print("   ", text_of(page, "Rows filtered"))
    shot(page, "01-marketing-sql-masked")


def sales(page: Page) -> None:
    sign_in(page, "lukas.brandner")
    page.goto(f"{WEB}/{WS}/query")
    page.wait_for_load_state("networkidle")
    run_sql(page, f"SELECT first_name, last_name, email, phone, region\nFROM {K}.contacts\nWHERE contact_id = 1001")
    print("   ", text_of(page, "Margarethe"))
    shot(page, "02-sales-sql-clear")


def steward(page: Page) -> None:
    sign_in(page, "henrike.sauer")
    page.goto(f"{WEB}/{WS}/assets")
    page.wait_for_load_state("networkidle")
    link = page.get_by_text("crm.contacts").first
    if link.count():
        link.click()
        page.wait_for_load_state("networkidle")
        gov = page.get_by_role("tab", name="Governance")
        if gov.count():
            gov.first.click()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1500)
        print("   ", page.url, text_of(page, "Columns"))
        shot(page, "03-steward-governance")
    else:
        print("   no crm.contacts link on the assets page")
        shot(page, "03-steward-assets")


def agency(page: Page) -> None:
    sign_in(page, "jonas.eklund")
    page.goto(f"{WEB}/{WS}/query")
    page.wait_for_load_state("networkidle")
    run_sql(page, "SELECT region, wayfarer_tier, count(*) AS travellers\nFROM shared.marketing.traveller_360\n"
                  "GROUP BY ALL ORDER BY travellers DESC")
    shot(page, "04-agency-dataset")
    for path in ("findings", "sources", "assets"):
        page.goto(f"{WEB}/{WS}/{path}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        print(f"   /{path}:", page.inner_text("body")[:200].replace("\n", " | "))
    shot(page, "05-agency-findings")


def care(page: Page) -> None:
    sign_in(page, "kwame.mensah")
    page.goto(f"{WEB}/{WS}/query")
    page.wait_for_load_state("networkidle")
    run_sql(page, "SELECT ticket_id, requester_email, subject, body\nFROM support_desk.support.tickets\n"
                  "ORDER BY opened_at DESC LIMIT 20")
    print("   ", text_of(page, "Masked for you"))
    shot(page, "06-care-tickets")


STEPS = {"marketing": marketing, "sales": sales, "steward": steward, "agency": agency, "care": care}

if __name__ == "__main__":
    wanted = sys.argv[1:] or list(STEPS)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=__import__('os').environ.get('KF_CHROME') or None)
        for name in wanted:
            context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-GB")
            page = context.new_page()
            try:
                STEPS[name](page)
            except Exception as error:  # noqa: BLE001
                print(f"[{name}] FAILED: {error}")
                shot(page, f"error-{name}")
            context.close()
        browser.close()
