# Seeding and probing tools for the lakehouse lab, run on the lab's network so
# they see storage and catalogs at the same addresses the scan pods do.
FROM python:3.12-slim
RUN pip install --no-cache-dir \
      "duckdb==2.0.0" "pyiceberg[pyarrow,sql-sqlite]==0.12.0" "deltalake==1.6.6" \
      "pylance==14.0.2" "boto3==1.43.10" "trino==0.336.0" "psycopg2-binary==2.9.12" \
      "azure-storage-blob==12.31.1"
WORKDIR /seed
