import azure.functions as func
from azure.data.tables import TableServiceClient
import logging
import os

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@app.route(route="hello")
def dbupdater(req: func.HttpRequest) -> func.HttpResponse:
    try:
        # Get connection string from environment variable
        connection_string = os.environ.get("AZURITE_CONNECTION_STRING")
        
        if not connection_string:
            logging.error("AZURITE_CONNECTION_STRING environment variable not set")
            return func.HttpResponse(
                "Configuration error: AZURITE_CONNECTION_STRING not set",
                status_code=500
            )

        table_service_client = TableServiceClient.from_connection_string(connection_string)
        
        # Create a test table to verify connection
        test_table_name = "testtable"
        table_client = table_service_client.get_table_client(test_table_name)
        
        try:
            # Try to create the table (this will make a real network call)
            table_client.create_table()
            logging.info(f"Successfully created test table: {test_table_name}")
            table_created = True
        except Exception as create_error:
            # If table already exists, that's also a success
            if "TableAlreadyExists" in str(create_error) or "already exists" in str(create_error).lower():
                logging.info(f"Test table already exists: {test_table_name}")
                table_created = True
            else:
                raise create_error
        
        # Now list tables to see what we have
        tables = list(table_service_client.list_tables())
        logging.info(f"Successfully connected to Azurite Table Storage! Found {len(tables)} tables.")
        
        return func.HttpResponse(
            f"Successfully connected to Azurite Table Storage! Created/found test table '{test_table_name}'. Total tables: {len(tables)}",
            status_code=200
        )
    except Exception as e:
        logging.error(f"Error connecting to Azurite: {str(e)}")
        return func.HttpResponse(
            f"Error connecting to Azurite: {str(e)}",
            status_code=500
        )