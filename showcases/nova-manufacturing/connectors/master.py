# Master data: the company's own directory. Every record here *is* a named thing
# (a supplier, a customer, a plant, a machine, a part) and declares it as an entity,
# so any note, order or measurement anywhere that mentions it joins the same page.

PART_NAMES = {
    "C431": "C431 housing", "C100": "C100 seal cartridge", "CSTEEL": "Stainless steel feedstock", "CRESIN": "Sealing resin",
    "CBRG": "Bearing kit", "CGSK": "Flange gasket set", "C999": "Gasket adaptor", "CIMP": "Pump impeller",
}
COUNTRIES = {"DE": "Germany", "CZ": "Czechia", "IT": "Italy", "SE": "Sweden"}

SUPPLIER_ROLE = {
    "S001": ("tier-one-supplier", "Tier-1 supplier of C431 housings and stainless steel feedstock."),
    "S002": ("tier-one-supplier", "Tier-1 supplier of C431 housings and resin."),
    "S003": ("tier-one-supplier", "Tier-1 supplier of steel feedstock and resin; low-price, lower-yield supplier."),
    "S004": ("tier-one-supplier", "Tier-1 supplier with its own, independent foundry."),
    "F001": ("upstream-foundry", "Upstream foundry that casts C431 housings for Nova's tier-1 suppliers."),
    "F002": ("upstream-foundry", "Upstream foundry that casts C431 housings for Nova's tier-1 suppliers."),
}


def extract():
    suppliers = table("suppliers.csv")
    customers = table("customers.csv")
    plants = table("plants.csv")
    machines = table("machines.csv")
    components = table("components.csv")
    products = table("products.csv")
    plant_name = {p["plant_id"]: p["name"] for p in plants}

    for s in suppliers:
        role, blurb = SUPPLIER_ROLE[s["supplier_id"]]
        yield record(
            f"supplier-{s['supplier_id']}", f"{s['name']} ({s['supplier_id']})",
            f"Supplier {s['supplier_id']} — {s['name']}, {COUNTRIES[s['country']]}. {blurb}",
            "supplier", ("supplier", s["supplier_id"]),
            facts={"supplier_id": s["supplier_id"], "country": s["country"], "role": role},
            entity=Entity(type="ORGANIZATION", name=s["name"],
                          identifiers={"regex:supplier_code": s["supplier_id"]},
                          attributes={"country": COUNTRIES[s["country"]], "role": blurb}))

    for c in customers:
        yield record(
            f"customer-{c['customer_id']}", f"{c['name']} ({c['customer_id']})",
            f"Customer {c['customer_id']} — {c['name']}. Service priority {c['priority']} (1 is highest).",
            "customer", ("customer", c["customer_id"]),
            facts={"customer_id": c["customer_id"], "priority": num(c["priority"])},
            entity=Entity(type="ORGANIZATION", name=c["name"],
                          identifiers={"regex:customer_code": c["customer_id"]},
                          attributes={"service_priority": c["priority"]}))

    for p in plants:
        yield record(
            f"plant-{p['plant_id']}", f"{p['name']} ({p['plant_id']})",
            f"Plant {p['plant_id']} — {p['name']} ({COUNTRIES.get(p['country'], p['country'])}), time zone {p['timezone']}.",
            "plant", ("plant", p["plant_id"]),
            facts={"plant_id": p["plant_id"]},
            entity=Entity(type="LOCATION", name=p["name"],
                          identifiers={"regex:plant_code": p["plant_id"]},
                          aliases=[p["name"].replace("Nova ", "")],
                          attributes={"country": p["country"], "timezone": p["timezone"]}))

    for m in machines:
        yield record(
            f"machine-{m['machine_id']}", f"Machine {m['machine_id']}",
            f"Machine {m['machine_id']} — {m['machine_type']}, installed {m['installed_year']}, at {plant_name[m['plant_id']]} ({m['plant_id']}).",
            "machine", ("machine", m["machine_id"]),
            facts={"machine_id": m["machine_id"], "plant_id": m["plant_id"]},
            entity=Entity(type="REFERENCE", name=f"Machine {m['machine_id']}",
                          identifiers={"regex:machine_code": m["machine_id"]},
                          attributes={"type": m["machine_type"], "plant": m["plant_id"], "installed": m["installed_year"]}))

    for c in components:
        yield record(
            f"component-{c['component_id']}", f"{c['component_id']} — {c['description']}",
            f"Component {c['component_id']} — {c['description']} (unit: {c['base_uom']}).",
            "component", ("component", c["component_id"]),
            facts={"component_id": c["component_id"]},
            entity=Entity(type="REFERENCE", name=PART_NAMES.get(c["component_id"], c["description"]),
                          identifiers={"regex:component_code": c["component_id"]},
                          attributes={"description": c["description"], "uom": c["base_uom"]}))

    bom = table("bill_of_materials.csv")
    for p in products:
        lines = [b for b in bom if b["product_id"] == p["product_id"]]
        parts = ", ".join(f"{b['quantity_per_unit']} {b['base_uom']} {b['component_id']}" for b in lines)
        yield record(
            f"product-{p['product_id']}", f"{p['name']} ({p['product_id']})",
            f"Product {p['product_id']} — {p['name']}, list price {eur(p['price_eur'])}. Per pump: {parts}.",
            "product", ("product", p["product_id"]),
            facts={"product_id": p["product_id"], "price_eur": num(p["price_eur"]), "bom": [
                {"component_id": b["component_id"], "per_unit": num(b["quantity_per_unit"])} for b in lines]},
            entity=Entity(type="REFERENCE", name=f"{p['name']} {p['product_id']}",
                          identifiers={"regex:product_code": p["product_id"]},
                          attributes={"list_price_eur": p["price_eur"]}))


def relationships():
    for m in table("machines.csv"):
        yield contains(Ref.asset(f"plant-{m['plant_id']}"), Ref.asset(f"machine-{m['machine_id']}"))
    for b in table("bill_of_materials.csv"):
        yield references(Ref.asset(f"product-{b['product_id']}"), Ref.asset(f"component-{b['component_id']}"))
    for s in table("suppliers.csv"):
        role = SUPPLIER_ROLE[s["supplier_id"]][0]
        yield means(Ref.asset(f"supplier-{s['supplier_id']}"), Ref.term(role))
    for c in table("customers.csv"):
        yield means(Ref.asset(f"customer-{c['customer_id']}"), Ref.term("customer"))
    for p in table("plants.csv"):
        yield means(Ref.asset(f"plant-{p['plant_id']}"), Ref.term("plant"))
    for m in table("machines.csv"):
        yield means(Ref.asset(f"machine-{m['machine_id']}"), Ref.term("production-machine"))
    for c in table("components.csv"):
        yield means(Ref.asset(f"component-{c['component_id']}"), Ref.term("component"))
    for p in table("products.csv"):
        yield means(Ref.asset(f"product-{p['product_id']}"), Ref.term("pump-product"))


def test_connection():
    names = [f.name for f in ctx.files]
    return {"status": "SUCCESS", "message": f"{len(names)} master-data files ready"}
