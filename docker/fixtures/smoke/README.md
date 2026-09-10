# Smoke-test fixture

A deliberately careless-looking corpus, mounted into the container by
`docker/scripts/smoke.sh` and scanned end to end.

Its only job is to make the whole pipeline produce a finding: file discovery →
text extraction → the Python detector subprocess → the REST callback into the
API → a row in the database. If a finding comes out of this, every moving part
of the all-in-one image works.

**Every credential in here is fake.** The values are syntactically valid so that
the detectors recognise their shape, and they authenticate against nothing —
they were written by hand for this test and have never existed anywhere.
