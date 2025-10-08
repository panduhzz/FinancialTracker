import azure.functions as func
import logging
import os
import io
import uuid
import json
from datetime import datetime
from azure.core.credentials import AzureKeyCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.storage.blob import BlobServiceClient

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
#test
@app.route(route="test", methods=["GET"])
def test(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Test endpoint called.')
    return func.HttpResponse(
        '{"message": "Function app is running!"}',
        status_code=200,
        mimetype="application/json"
    )

# Initialize Azure Document Intelligence client
def get_document_intelligence_client():
    endpoint = os.getenv("ENDPOINT")
    key = os.getenv("KEY")
    return DocumentIntelligenceClient(
        endpoint=endpoint, 
        credential=AzureKeyCredential(key)
    )

# Initialize Azure Blob Storage client
def get_blob_service_client():
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    return BlobServiceClient.from_connection_string(connection_string)

@app.route(route="financialUpload", methods=["POST", "OPTIONS"])
def financialUpload(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('=== FINANCIAL UPLOAD FUNCTION STARTED ===')
    logging.info('Python HTTP trigger function processed a request.')
    logging.info(f'Request method: {req.method}')
    logging.info(f'Request headers: {dict(req.headers)}')
    logging.info(f'Request files: {req.files}')
    print('=== FINANCIAL UPLOAD FUNCTION STARTED ===')
    print(f'Request method: {req.method}')
    print(f'Request files: {req.files}')

    # CORS headers for all responses
    cors_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }

    # Handle CORS preflight request
    if req.method == "OPTIONS":
        return func.HttpResponse(
            "",
            status_code=200,
            headers=cors_headers
        )

    # Check if file is uploaded
    if not req.files:
        logging.error('No files in request')
        return func.HttpResponse(
            '{"error": "No file uploaded"}', 
            status_code=400,
            mimetype="application/json",
            headers=cors_headers
        )
    
    # Get the first file from the request
    file = list(req.files.values())[0]
    logging.info(f'File received: {file.filename if file else "None"}')
    
    if not file or file.filename == '':
        logging.error('No file selected or empty filename')
        return func.HttpResponse(
            '{"error": "No file selected"}', 
            status_code=400,
            mimetype="application/json",
            headers=cors_headers
        )
    
    # Check environment variables first
    print('=== CHECKING ENVIRONMENT VARIABLES ===')
    endpoint = os.getenv("ENDPOINT")
    key = os.getenv("KEY")
    storage_conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME")
    
    print(f'ENDPOINT: {endpoint}')
    print(f'KEY: {"***" if key else "None"}')
    print(f'STORAGE_CONN: {"***" if storage_conn else "None"}')
    print(f'CONTAINER: {container_name}')
    
    if not endpoint or not key:
        logging.error('Missing Document Intelligence credentials')
        return func.HttpResponse(
            '{"error": "Document Intelligence not configured"}', 
            status_code=500,
            mimetype="application/json",
            headers=cors_headers
        )
    
    if not storage_conn or not container_name:
        logging.error('Missing Storage credentials')
        return func.HttpResponse(
            '{"error": "Storage not configured"}', 
            status_code=500,
            mimetype="application/json",
            headers=cors_headers
        )
    
    # Process the file
    print(f'=== FILE RECEIVED: {file.filename} ===')
    print('Starting file processing...')
    
    try:
        # Generate unique blob name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        blob_name = f"bank-statement_{timestamp}_{unique_id}.pdf"
        print(f'Generated blob name: {blob_name}')
        
        # Get blob service client
        blob_service_client = get_blob_service_client()
        print('Blob service client created successfully')
        
        # Create container if it doesn't exist
        try:
            blob_service_client.create_container(container_name)
            print('Container created or already exists')
        except Exception as e:
            print(f'Container creation warning: {str(e)}')
        
        # Upload file to Azure Blob Storage
        file_content = file.read()
        print(f'File content size: {len(file_content)} bytes')
        
        blob_client = blob_service_client.get_blob_client(
            container=container_name, 
            blob=blob_name
        )
        blob_client.upload_blob(file_content, overwrite=True)
        print('File uploaded to blob storage')
        
        # Process with Azure Document Intelligence
        blob_data = blob_client.download_blob().readall()
        print('Downloaded blob data for processing')
        
        document_intelligence_client = get_document_intelligence_client()
        print('Document intelligence client created')
        
        poller = document_intelligence_client.begin_analyze_document(
            "prebuilt-bankStatement.us", 
            body=io.BytesIO(blob_data)         
        )
        bankstatements = poller.result()
        print('Document analysis completed')
        
        # Extract the required information
        result = extract_bank_statement_data(bankstatements)
        print(f'Extracted data: {result}')
        
        # Delete the blob from Azure Storage after analysis
        try:
            blob_client.delete_blob()
            result['blob_deleted'] = True
            print('Blob deleted successfully')
        except Exception as delete_error:
            result['blob_deleted'] = False
            result['delete_error'] = str(delete_error)
            print(f'Blob deletion warning: {str(delete_error)}')
        
        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers=cors_headers
        )
        
    except Exception as e:
        logging.error(f'Processing failed: {str(e)}')
        print(f'Processing failed: {str(e)}')
        return func.HttpResponse(
            f'{{"error": "Processing failed: {str(e)}"}}', 
            status_code=500,
            mimetype="application/json",
            headers=cors_headers
        )


def extract_bank_statement_data(bankstatements):
    """
    Extract account number, starting balance, ending balance, and transactions
    """
    extracted_data = {
        'account_number': None,
        'starting_balance': None,
        'ending_balance': None,
        'transactions': []
    }
    
    for statement in bankstatements.documents:
        accounts = statement.fields.get("Accounts")
        if accounts:
            for account in accounts.value_array:
                # Account Number
                account_number = account.value_object.get("AccountNumber")
                if account_number:
                    extracted_data['account_number'] = account_number.value_string
                
                # Starting Balance (Beginning Balance)
                beginning_balance = account.value_object.get("BeginningBalance")
                if beginning_balance:
                    extracted_data['starting_balance'] = beginning_balance.value_number
                
                # Ending Balance
                ending_balance = account.value_object.get("EndingBalance")
                if ending_balance:
                    extracted_data['ending_balance'] = ending_balance.value_number
                
                # Transactions
                transactions = account.value_object.get("Transactions")
                if transactions:
                    for transaction in transactions.value_array:
                        transaction_data = {}
                        
                        # Date
                        transaction_date = transaction.value_object.get("Date")
                        if transaction_date:
                            transaction_data['date'] = str(transaction_date.value_date)
                        
                        # Description
                        description = transaction.value_object.get("Description")
                        if description:
                            transaction_data['description'] = description.value_string
                        
                        # Amount (combine deposit and withdrawal)
                        deposit_amount = transaction.value_object.get("DepositAmount")
                        withdrawal_amount = transaction.value_object.get("WithdrawalAmount")
                        
                        if deposit_amount and deposit_amount.value_number:
                            transaction_data['amount'] = deposit_amount.value_number
                            transaction_data['type'] = 'deposit'
                        elif withdrawal_amount and withdrawal_amount.value_number:
                            transaction_data['amount'] = withdrawal_amount.value_number
                            transaction_data['type'] = 'withdrawal'
                        
                        if transaction_data:  # Only add if we have some data
                            extracted_data['transactions'].append(transaction_data)
    
    return extracted_data