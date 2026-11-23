"""Kestrel & Finch Journeys: the invented tour operator behind this showcase.

Pure standard library and deterministic (one seeded RNG), so every run writes
the same people into the same systems. ``load.py`` puts the rows into the lab
services; this module only decides what the rows are.

The story: Kestrel Reisen (Innsbruck, DACH) merged in 2024 with Finch Tours
(Edinburgh, UK and the Nordics) and kept both CRMs. The Wayfarer Club loyalty
programme sits in the lakehouse, the support desk in a DuckLake, and the
billing system is a legacy PostgreSQL that only an ODBC driver reaches.
The same traveller often lives in three or four of them, spelt differently.
"""

from __future__ import annotations

import datetime as dt
import random
from dataclasses import dataclass, field

SEED = 20261123
RNG = random.Random(SEED)

# ── people ─────────────────────────────────────────────────────────────────

COUNTRIES = {
    # code: (region, first names, last names, mail domains, phone maker)
    "AT": "DACH",
    "DE": "DACH",
    "CH": "DACH",
    "SE": "Nordics",
    "NO": "Nordics",
    "DK": "Nordics",
    "FI": "Nordics",
    "GB": "UK & Ireland",
    "IE": "UK & Ireland",
    "NL": "Benelux",
    "BE": "Benelux",
}
FIRST = {
    "AT": ["Margarethe", "Lukas", "Johanna", "Florian", "Theresa", "Matthias", "Valentina", "Stefan"],
    "DE": ["Henrike", "Jonas", "Friederike", "Malte", "Annika", "Tobias", "Wiebke", "Niklas"],
    "CH": ["Seraina", "Reto", "Ladina", "Urs", "Corina", "Beat"],
    "SE": ["Sigrid", "Elias", "Maja", "Oskar", "Astrid", "Viktor", "Linnea"],
    "NO": ["Ingrid", "Håkon", "Solveig", "Eirik", "Ragnhild"],
    "DK": ["Freja", "Mads", "Ida", "Rasmus", "Signe"],
    "FI": ["Aino", "Eero", "Helmi", "Juho", "Venla"],
    "GB": ["Imogen", "Callum", "Harriet", "Rhys", "Poppy", "Alasdair", "Fiona"],
    "IE": ["Aoife", "Cian", "Saoirse", "Oisín", "Niamh"],
    "NL": ["Femke", "Joris", "Sanne", "Bram", "Lotte"],
    "BE": ["Elise", "Wout", "Margaux", "Pieter"],
}
LAST = {
    "AT": ["Albrecht", "Brandner", "Gruber", "Huber", "Pichler", "Steiner", "Moser", "Hofer"],
    "DE": ["Sauer", "Krüger", "Lindemann", "Vogt", "Hartmann", "Brinkmann", "Ziegler"],
    "CH": ["Caflisch", "Meier", "Bühler", "Gasser", "Tschudi"],
    "SE": ["Halvorsen", "Lindqvist", "Bergström", "Nyberg", "Sjöberg", "Ekholm"],
    "NO": ["Haugland", "Solberg", "Nygaard", "Bakke"],
    "DK": ["Kjær", "Thomsen", "Østergaard", "Lund"],
    "FI": ["Virtanen", "Mäkelä", "Koskinen", "Heikkilä"],
    "GB": ["Pemberton", "MacLeod", "Ashworth", "Fairbairn", "Whitlock", "Drummond"],
    "IE": ["Ó Briain", "Gallagher", "Kavanagh", "Doherty"],
    "NL": ["van Dijk", "de Vries", "Bakker", "Visser"],
    "BE": ["Peeters", "Janssens", "Dubois", "Maes"],
}
MAIL = ["inbox.example.com", "post.example.net", "mailbox.example.org", "fjord.example.net", "alpenmail.example.com"]
# Real top-level domains: the e-mail recogniser checks the TLD, and an address
# under .example or .test is not taken for one.

PHONE = {
    # Valid mobile ranges, so the phone recogniser takes them for real numbers.
    "AT": lambda r: f"+43 664 {r.randint(1000000, 9999999)}",
    "DE": lambda r: f"+49 151 {r.randint(10000000, 99999999)}",
    "CH": lambda r: f"+41 79 {r.randint(100, 999)} {r.randint(10, 99)} {r.randint(10, 99)}",
    "SE": lambda r: f"+46 70 {r.randint(100, 999)} {r.randint(10, 99)} {r.randint(10, 99)}",
    "NO": lambda r: f"+47 4{r.randint(10, 99)} {r.randint(10, 99)} {r.randint(100, 999)}",
    "DK": lambda r: f"+45 2{r.randint(1000000, 9999999)}",
    "FI": lambda r: f"+358 40 {r.randint(1000000, 9999999)}",
    "GB": lambda r: f"+44 7700 900{r.randint(100, 999)}",
    "IE": lambda r: f"+353 87 {r.randint(1000000, 9999999)}",
    "NL": lambda r: f"+31 6 {r.randint(10000000, 99999999)}",
    "BE": lambda r: f"+32 470 {r.randint(10, 99)} {r.randint(10, 99)} {r.randint(10, 99)}",
}
IBAN_LEN = {"AT": 16, "DE": 18, "CH": 17, "SE": 20, "NO": 11, "DK": 14, "FI": 14,
            "GB": None, "IE": None, "NL": None, "BE": 12}


def iban(country: str, r: random.Random) -> str:
    """A checksum-valid IBAN (made-up bank and account)."""
    if country in ("GB", "IE"):
        bban = ("NWBK" if country == "GB" else "AIBK") + "".join(str(r.randint(0, 9)) for _ in range(14))
    elif country == "NL":
        bban = "ABNA" + "".join(str(r.randint(0, 9)) for _ in range(10))
    else:
        bban = "".join(str(r.randint(0, 9)) for _ in range(IBAN_LEN[country]))
    digits = "".join(str(int(c, 36)) for c in bban + country + "00")
    check = 98 - int(digits) % 97
    raw = f"{country}{check:02d}{bban}"
    return " ".join(raw[i:i + 4] for i in range(0, len(raw), 4))


def at_svnr(birth: dt.date, r: random.Random) -> str:
    """An Austrian social insurance number with a valid check digit."""
    while True:
        serial = f"{r.randint(100, 999)}"
        date = birth.strftime("%d%m%y")
        digits = [int(c) for c in serial + "0" + date]
        weights = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6]
        check = sum(d * w for d, w in zip(digits, weights, strict=True)) % 11
        if check < 10:
            return f"{serial}{check} {date}"


TEST_CARDS = [  # Luhn-valid test numbers, the kind people paste into tickets
    "4111 1111 1111 1111", "5555 5555 5555 4444", "4012 8888 8888 1881",
    "3782 822463 10005", "5105 1051 0510 5100", "4000 0566 5566 5556",
]


def slug(text: str) -> str:
    table = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "å": "aa", "ø": "oe", "æ": "ae",
                           "é": "e", "í": "i", "ó": "o", "ß": "ss", " ": "", "'": ""})
    return text.lower().translate(table)


@dataclass
class Person:
    pid: int
    first: str
    last: str
    country: str
    region: str
    email: str
    phone: str
    birth: dt.date
    iban: str
    passport: str
    in_kestrel: bool = False
    in_finch: bool = False
    in_wayfarer: bool = False
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def name(self) -> str:
        return f"{self.first} {self.last}"


def people(n: int = 320) -> list[Person]:
    rng = random.Random(SEED)
    out: list[Person] = []
    codes = list(COUNTRIES)
    weights = [14, 16, 6, 10, 6, 5, 5, 12, 5, 6, 4]
    seen: set[str] = set()
    for pid in range(1, n + 1):
        country = rng.choices(codes, weights)[0]
        first = rng.choice(FIRST[country])
        last = rng.choice(LAST[country])
        local = f"{slug(first)}.{slug(last)}"
        while local in seen:
            local = f"{slug(first)}.{slug(last)}{rng.randint(2, 99)}"
        seen.add(local)
        birth = dt.date(1948, 1, 1) + dt.timedelta(days=rng.randint(0, 365 * 55))
        p = Person(
            pid=pid, first=first, last=last, country=country, region=COUNTRIES[country],
            email=f"{local}@{rng.choice(MAIL)}", phone=PHONE[country](rng), birth=birth,
            iban=iban(country, rng),
            passport=f"{rng.choice('CFGHJK')}{rng.randint(1000000, 9999999)}{rng.choice('LMNPRT')}",
        )
        # Who is where: DACH people mostly came with Kestrel, UK and Nordic
        # people with Finch; a third of everyone overlaps.
        kestrel_bias = 0.85 if p.region in ("DACH", "Benelux") else 0.3
        p.in_kestrel = rng.random() < kestrel_bias
        p.in_finch = rng.random() < (0.85 if not p.in_kestrel else 0.35)
        p.in_wayfarer = rng.random() < 0.6
        out.append(p)
    return out


# The traveller the blog follows through every system.
STAR = Person(
    pid=0, first="Margarethe", last="Albrecht", country="AT", region="DACH",
    email="margarethe.albrecht@alpenmail.example.com", phone="+43 664 2718281",
    birth=dt.date(1971, 5, 14), iban="AT48 3200 0000 1234 5864", passport="P4817263",
    in_kestrel=True, in_finch=True, in_wayfarer=True,
)

REPS = {
    "DACH": ["Lukas Brandner", "Theresa Moser"],
    "Nordics": ["Sigrid Halvorsen", "Mads Thomsen"],
    "UK & Ireland": ["Callum Drummond", "Aoife Gallagher"],
    "Benelux": ["Femke Visser"],
}
TRIPS = [
    ("Dolomites Hut-to-Hut", 2450), ("Lofoten Light Week", 3180), ("Hebrides by Sail", 2890),
    ("Vienna to Budapest by Rail", 1390), ("Swiss Glacier Express", 2140), ("Lapland Aurora Camp", 3620),
    ("Wachau Wine Cycling", 1180), ("Faroe Islands Hiking", 2760), ("Copenhagen Food Weekend", 890),
    ("Highlands Whisky Trail", 1650), ("Stockholm Archipelago Kayak", 1990),
]
STAGES = ["enquiry", "quoted", "booked", "travelled", "cancelled"]
DIETARY = [None, None, None, None, "Vegetarian", "Vegan", "Coeliac (gluten-free)",
           "Peanut allergy — carries EpiPen", "Type 1 diabetic, needs fridge in room",
           "Lactose intolerant", "Halal", "Kosher"]


def day(rng: random.Random, start: str, span_days: int) -> dt.date:
    return dt.date.fromisoformat(start) + dt.timedelta(days=rng.randint(0, span_days))


def stamp(rng: random.Random, start: str, span_days: int) -> dt.datetime:
    d = day(rng, start, span_days)
    return dt.datetime(d.year, d.month, d.day, rng.randint(7, 21), rng.randint(0, 59), tzinfo=dt.UTC)


# ── Kestrel CRM (PostgreSQL, HubSpot-style) ─────────────────────────────────


def kestrel(ps: list[Person]) -> dict[str, list[dict]]:
    rng = random.Random(SEED + 1)
    contacts, deals, notes = [], [], []
    members = [STAR] + [p for p in ps if p.in_kestrel]
    for cid, p in enumerate(members, start=1001):
        p.tags["kestrel_id"] = str(cid)
        contacts.append({
            "contact_id": cid, "first_name": p.first, "last_name": p.last, "email": p.email,
            "phone": p.phone, "birth_date": p.birth, "country": p.country, "region": p.region,
            "svnr": at_svnr(p.birth, rng) if p.country == "AT" else None,
            "lifecycle_stage": rng.choice(["subscriber", "lead", "customer", "customer", "evangelist"]),
            "owner_rep": rng.choice(REPS[p.region]),
            "marketing_opt_in": rng.random() < 0.6,
            "created_at": stamp(rng, "2019-02-01", 2000),
        })
        for _ in range(rng.choice([0, 1, 1, 2, 3])):
            trip, price = rng.choice(TRIPS)
            pax = rng.choice([1, 2, 2, 2, 3, 4])
            deals.append({
                "deal_id": len(deals) + 50001, "contact_id": cid, "trip": trip,
                "departure_date": day(rng, "2024-03-01", 900), "travellers": pax,
                "amount_eur": round(price * pax * rng.uniform(0.9, 1.15), 2),
                "stage": rng.choice(STAGES), "region": p.region,
            })
        if rng.random() < 0.45 or p is STAR:
            notes.append({
                "note_id": len(notes) + 1, "contact_id": cid,
                "author": rng.choice(REPS[p.region]), "created_at": stamp(rng, "2023-01-01", 1000),
                "body": note_text(p, rng),
            })
    return {"contacts": contacts, "deals": deals, "notes": notes}


def note_text(p: Person, rng: random.Random) -> str:
    options = [
        f"Called {p.first} back on {p.phone}, wants the early-bird price for next summer.",
        f"{p.name} asked us to use her private address only; partner's number is "
        f"{PHONE[p.country](rng)}.",
        f"Passport {p.passport} expires before departure, reminded {p.first} to renew.",
        f"Refund of EUR {rng.randint(90, 900)} to {p.iban} approved by finance.",
        f"{p.first} mentioned a knee operation in spring, book ground-floor rooms.",
        "Prefers WhatsApp over e-mail. Do not call before 10.",
    ]
    if p is STAR:
        return (f"Margarethe called from {p.phone}: anniversary trip, wants the Lofoten week with "
                f"the Finch team. Passport {p.passport}. Pay the deposit back to {p.iban}.")
    return rng.choice(options)


# ── Finch Tours CRM (Salesforce export as Delta tables) ─────────────────────


def sf_id(prefix: str, n: int) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
    r = random.Random(f"{prefix}{n}")
    return prefix + "5g0000" + "".join(r.choice(alphabet) for _ in range(9))


def finch(ps: list[Person]) -> dict[str, list[dict]]:
    rng = random.Random(SEED + 2)
    contacts, opportunities = [], []
    members = [STAR] + [p for p in ps if p.in_finch]
    for n, p in enumerate(members):
        cid = sf_id("003", n)
        p.tags["finch_id"] = cid
        # Salesforce imports kept whatever case the web form sent.
        email = p.email
        if p is STAR:
            email = "Margarethe.Albrecht@alpenmail.example.com"
        elif p.in_kestrel and rng.random() < 0.35:
            email = p.email.title()
        contacts.append({
            "Id": cid, "FirstName": p.first, "LastName": p.last, "Email": email,
            "MobilePhone": p.phone.replace(" ", ""), "MailingCountry": p.country,
            "Region__c": p.region, "Passport_Number__c": p.passport,
            "Birthdate": p.birth, "Dietary_Requirements__c": rng.choice(DIETARY)
            if p is not STAR else "Coeliac (gluten-free)",
            "HasOptedOutOfEmail": rng.random() < 0.3,
            "CreatedDate": stamp(rng, "2018-06-01", 2200),
        })
        for _ in range(rng.choice([0, 1, 1, 2])):
            trip, price = rng.choice(TRIPS)
            opportunities.append({
                "Id": sf_id("006", len(opportunities)), "ContactId": cid, "Name": f"{p.last} — {trip}",
                "Amount": round(price * rng.choice([1, 2, 2, 3]) * rng.uniform(0.9, 1.2), 2),
                "CurrencyIsoCode": "GBP" if p.country in ("GB", "IE") else "EUR",
                "CloseDate": day(rng, "2024-01-01", 800), "StageName":
                    rng.choice(["Prospecting", "Proposal", "Closed Won", "Closed Won", "Closed Lost"]),
                "Region__c": p.region,
            })
    return {"contact": contacts, "opportunity": opportunities}


# ── Wayfarer Club loyalty (Iceberg through Polaris) ─────────────────────────


def wayfarer(ps: list[Person]) -> dict[str, list[dict]]:
    rng = random.Random(SEED + 3)
    members, redemptions = [], []
    rows = [STAR] + [p for p in ps if p.in_wayfarer]
    for n, p in enumerate(rows):
        no = f"WF-{700000 + n * 7:07d}"
        p.tags["member_no"] = no
        tier = rng.choices(["Sparrow", "Kestrel", "Falcon", "Eagle"], [50, 30, 15, 5])[0]
        if p is STAR:
            tier = "Falcon"
        members.append({
            "member_no": no, "full_name": p.name, "email": p.email.upper() if rng.random() < 0.1 else p.email,
            "iban": p.iban, "tier": tier, "points_balance": rng.randint(0, 48000),
            "home_country": p.country, "region": p.region, "joined_on": day(rng, "2016-01-01", 3200),
        })
        for _ in range(rng.choice([0, 0, 1, 2])):
            redemptions.append({
                "redemption_id": len(redemptions) + 1, "member_no": no,
                "reward": rng.choice(["Lounge pass", "Upgrade", "€50 voucher", "Free excursion"]),
                "points": rng.choice([2500, 5000, 7500, 12000]),
                "redeemed_at": stamp(rng, "2023-01-01", 1000),
            })
    return {"members": members, "redemptions": redemptions}


# ── support desk (DuckLake) ─────────────────────────────────────────────────

AGENTS = ["Kwame Mensah", "Elin Nyberg", "Rosa Delgado", "Finn O'Malley"]
SUBJECTS = [
    "Change of travel dates", "Refund for cancelled ferry", "Dietary needs on tour",
    "Can't log in to My Trips", "Invoice address wrong", "Lost luggage in Tromsø",
    "Room upgrade request", "Passport name mismatch",
]


def support(ps: list[Person]) -> dict[str, list[dict]]:
    rng = random.Random(SEED + 4)
    tickets = []
    pool = [STAR] + rng.sample(ps, 180)
    for n, p in enumerate(pool):
        subject = rng.choice(SUBJECTS)
        body = rng.choice([
            f"Hi, this is {p.first}. Please call me on {p.phone}, I'm travelling.",
            f"My card {rng.choice(TEST_CARDS)} was charged twice for the deposit.",
            f"The name on my passport is {p.name}, number {p.passport}. The booking has a typo.",
            "Could you resend the itinerary? The PDF link has expired.",
            f"Please refund to my account {p.iban}, not the card.",
            "Thanks for sorting out the room, all good now!",
        ])
        if p is STAR:
            subject = "Gluten-free meals on the Lofoten week"
            body = (f"Hello, Margarethe Albrecht here (Wayfarer {p.tags.get('member_no', '')}). I am coeliac; "
                    f"please make sure the boat kitchen knows. Mobile {p.phone}.")
        tickets.append({
            "ticket_id": 90001 + n, "opened_at": stamp(rng, "2025-01-01", 600),
            "channel": rng.choice(["email", "web", "phone", "whatsapp"]),
            "requester_email": p.email, "requester_name": p.name, "region": p.region,
            "subject": subject, "body": body, "status": rng.choice(["open", "pending", "solved", "solved"]),
            "agent": rng.choice(AGENTS),
        })
    # An agent's internal notes, where secrets end up.
    # Made-up keys, written in parts so no credential pattern sits in the source.
    aws_key = "AKIA" + "Z7KESTRELFINCH42"
    stripe_key = "sk_" + "live_" + "4eC39HqLyjWDarjtT1zdp7dc"
    internal = [
        "Booking API was down, used the integration key directly: "
        f"{aws_key} / wJalrXUtnFEMI/K7MDENG/bPxRfiCYKESTREL42",
        f"Stripe refund done by hand with {stripe_key} — rotate after?",
        "Reset the partner portal, temp password is Wayfarer!2025 (tell nobody)",
    ]
    for i, text in enumerate(internal):
        tickets[10 + i * 17]["body"] += f"\n\n[internal] {text}"
    return {"tickets": tickets}


# ── billing (legacy PostgreSQL, read over ODBC) ─────────────────────────────


def billing(ps: list[Person]) -> dict[str, list[dict]]:
    rng = random.Random(SEED + 5)
    invoices, cards = [], []
    payers = [STAR] + [p for p in ps if p.in_kestrel or p.in_finch]
    for p in payers:
        for _ in range(rng.choice([1, 1, 2, 3])):
            invoices.append({
                "invoice_no": f"KF-{2024 + rng.randint(0, 2)}-{len(invoices) + 10001}",
                "customer_email": p.email, "customer_name": p.name, "iban": p.iban,
                "amount": round(rng.uniform(380, 9800), 2),
                "currency": "GBP" if p.country in ("GB", "IE") else ("SEK" if p.country == "SE" else "EUR"),
                "issued_on": day(rng, "2024-01-01", 1000), "paid": rng.random() < 0.82, "region": p.region,
            })
        if rng.random() < 0.4 or p is STAR:
            cards.append({
                "pm_id": len(cards) + 1, "customer_email": p.email, "card_holder": p.name.upper(),
                "card_pan": rng.choice(TEST_CARDS).replace(" ", ""),
                "expiry": f"{rng.randint(1, 12):02d}/{rng.randint(26, 31)}",
            })
    return {"invoices": invoices, "payment_cards": cards}


def everything() -> dict[str, dict[str, list[dict]]]:
    ps = people()
    return {
        "kestrel": kestrel(ps),
        "finch": finch(ps),
        "wayfarer": wayfarer(ps),
        "support": support(ps),
        "billing": billing(ps),
    }


if __name__ == "__main__":
    data = everything()
    for system, tables in data.items():
        for name, rows in tables.items():
            print(f"{system}.{name}: {len(rows)} rows")
    print(data["kestrel"]["contacts"][0])
    print(data["finch"]["contact"][0])
