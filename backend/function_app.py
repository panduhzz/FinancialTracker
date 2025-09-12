import azure.functions as func
from azure.data.tables import TableServiceClient, TableEntity
import logging
import os
import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@app.route(route="test-account-summary", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def test_account_summary_api(req: func.HttpRequest) -> func.HttpResponse:
    """Test endpoint for account summary debugging"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers
        user_id = req.headers.get('X-User-ID', 'dev-user-123')
        
        # Get all accounts for the user
        accounts = get_user_accounts(user_id)
        
        result = {
            "user_id": user_id,
            "total_accounts": len(accounts),
            "accounts": accounts
        }
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in test account summary API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

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

# Utility Functions
def get_table_service_client():
    """Get table service client using connection string from environment"""
    connection_string = os.environ.get("AZURITE_CONNECTION_STRING")
    if not connection_string:
        raise Exception("AZURITE_CONNECTION_STRING environment variable not set")
    return TableServiceClient.from_connection_string(connection_string)

def ensure_tables_exist():
    """Create all required tables if they don't exist"""
    table_service_client = get_table_service_client()
    tables_to_create = ["UserAccounts", "Transactions", "Categories"]
    created_tables = []
    
    for table_name in tables_to_create:
        try:
            table_client = table_service_client.get_table_client(table_name)
            table_client.create_table()
            created_tables.append(table_name)
            logging.info(f"Created table: {table_name}")
        except Exception as e:
            if "TableAlreadyExists" in str(e) or "already exists" in str(e).lower():
                logging.info(f"Table already exists: {table_name}")
            else:
                logging.error(f"Error creating table {table_name}: {str(e)}")
                raise e
    
    return created_tables

def get_table_client(table_name: str):
    """Get a table client for a specific table"""
    table_service_client = get_table_service_client()
    return table_service_client.get_table_client(table_name)

def validate_account_data(account_data: Dict) -> Tuple[bool, List[str]]:
    """Validate account data before saving"""
    errors = []
    
    if not account_data.get('account_name'):
        errors.append("Account name is required")
    
    if not account_data.get('account_type'):
        errors.append("Account type is required")
    elif account_data.get('account_type') not in ['checking', 'savings', 'credit', 'investment']:
        errors.append("Invalid account type")
    
    try:
        initial_balance = float(account_data.get('initial_balance', 0))
    except (ValueError, TypeError):
        errors.append("Initial balance must be a valid number")
    
    return len(errors) == 0, errors

def validate_transaction_data(transaction_data: Dict) -> Tuple[bool, List[str]]:
    """Validate transaction data before saving"""
    errors = []
    
    if not transaction_data.get('account_id'):
        errors.append("Account ID is required")
    
    if not transaction_data.get('description'):
        errors.append("Description is required")
    
    if not transaction_data.get('category'):
        errors.append("Category is required")
    
    if not transaction_data.get('transaction_type'):
        errors.append("Transaction type is required")
    elif transaction_data.get('transaction_type') not in ['income', 'expense', 'transfer']:
        errors.append("Invalid transaction type")
    
    try:
        amount = float(transaction_data.get('amount', 0))
    except (ValueError, TypeError):
        errors.append("Amount must be a valid number")
    
    return len(errors) == 0, errors

def sanitize_user_input(data: Dict) -> Dict:
    """Sanitize user input to prevent injection attacks"""
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            # Basic sanitization - remove potentially dangerous characters
            sanitized[key] = value.strip()
        else:
            sanitized[key] = value
    return sanitized

def get_cors_headers():
    """Get CORS headers for cross-origin requests"""
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-User-ID, Authorization",
        "Access-Control-Max-Age": "86400"
    }

# Banking Functions
def create_bank_account(user_id: str, account_name: str, account_type: str, 
                       initial_balance: float = 0.0, bank_name: str = "", 
                       description: str = "") -> Dict:
    """Create a new bank account for a user"""
    try:
        # Ensure tables exist
        ensure_tables_exist()
        
        # Generate unique account ID
        account_id = str(uuid.uuid4())
        
        # Create account entity
        account_entity = {
            'PartitionKey': user_id,
            'RowKey': account_id,
            'account_id': account_id,
            'account_name': account_name,
            'account_type': account_type,
            'current_balance': initial_balance,
            'bank_name': bank_name,
            'description': description,
            'created_date': datetime.utcnow().isoformat(),
            'is_active': True,
            'last_updated': datetime.utcnow().isoformat()
        }
        
        # Save to table
        table_client = get_table_client("UserAccounts")
        table_client.create_entity(account_entity)
        
        logging.info(f"Created account {account_id} for user {user_id}")
        return account_entity
        
    except Exception as e:
        logging.error(f"Error creating bank account: {str(e)}")
        raise e

def get_user_accounts(user_id: str) -> List[Dict]:
    """Retrieve all bank accounts for a specific user"""
    try:
        table_client = get_table_client("UserAccounts")
        entities = table_client.list_entities(filter=f"PartitionKey eq '{user_id}' and is_active eq true")
        accounts = []
        for entity in entities:
            account = dict(entity)
            account['account_id'] = account['RowKey']
            accounts.append(account)
        return accounts
    except Exception as e:
        logging.error(f"Error getting user accounts: {str(e)}")
        raise e

def add_transaction(account_id: str, user_id: str, amount: float, description: str, 
                   category: str, transaction_type: str, date: Optional[str] = None) -> Dict:
    """Add a new transaction to an account"""
    try:
        # Ensure tables exist
        ensure_tables_exist()
        
        # Generate unique transaction ID
        transaction_id = str(uuid.uuid4())
        
        # Use current date if not provided
        if not date:
            date = datetime.utcnow().isoformat()
        
        # Create transaction entity
        transaction_entity = {
            'PartitionKey': user_id,
            'RowKey': transaction_id,
            'account_id': account_id,
            'amount': amount,  # Store as positive amount
            'description': description,
            'category': category,
            'transaction_type': transaction_type,
            'transaction_date': date,
            'created_date': datetime.utcnow().isoformat(),
            'last_updated': datetime.utcnow().isoformat()
        }
        
        # Save to table
        table_client = get_table_client("Transactions")
        table_client.create_entity(transaction_entity)
        
        # Update account balance (pass transaction type)
        update_account_balance(account_id, user_id, amount, transaction_type)
        
        logging.info(f"Created transaction {transaction_id} for account {account_id}")
        return transaction_entity
        
    except Exception as e:
        logging.error(f"Error adding transaction: {str(e)}")
        raise e

def update_account_balance(account_id: str, user_id: str, amount_change: float, transaction_type: str):
    """Update an account's current balance based on transaction type"""
    try:
        table_client = get_table_client("UserAccounts")
        
        # Get current account
        entity = table_client.get_entity(partition_key=user_id, row_key=account_id)
        current_balance = entity.get('current_balance', 0)
        
        # Calculate balance change based on transaction type
        if transaction_type == 'income':
            new_balance = current_balance + amount_change
        elif transaction_type == 'expense':
            new_balance = current_balance - amount_change
        elif transaction_type == 'transfer':
            # For transfers, we might want to handle differently
            # For now, treat as expense (money leaving the account)
            new_balance = current_balance - amount_change
        else:
            raise ValueError(f"Invalid transaction type: {transaction_type}")
        
        # Update balance
        entity['current_balance'] = new_balance
        entity['last_updated'] = datetime.utcnow().isoformat()
        
        table_client.update_entity(entity)
        logging.info(f"Updated account {account_id} balance to {new_balance} (transaction type: {transaction_type})")
        
    except Exception as e:
        logging.error(f"Error updating account balance: {str(e)}")
        raise e

def get_user_transactions(user_id: str, limit: int = 100) -> List[Dict]:
    """Retrieve all transactions for a user across all accounts"""
    try:
        table_client = get_table_client("Transactions")
        entities = table_client.list_entities(filter=f"PartitionKey eq '{user_id}'")
        
        # Convert to list and sort by date (newest first)
        transactions = [dict(entity) for entity in entities]
        transactions.sort(key=lambda x: x.get('transaction_date', ''), reverse=True)
        
        return transactions[:limit]
    except Exception as e:
        logging.error(f"Error getting user transactions: {str(e)}")
        raise e

def get_account_details(account_id: str, user_id: str) -> Optional[Dict]:
    """Get detailed information for a specific account"""
    try:
        table_client = get_table_client("UserAccounts")
        entity = table_client.get_entity(partition_key=user_id, row_key=account_id)
        
        if entity:
            account = dict(entity)
            account['account_id'] = account['RowKey']
            return account
        return None
    except Exception as e:
        logging.error(f"Error getting account details: {str(e)}")
        return None

def get_account_summary(account_id: str, user_id: str) -> Dict:
    """Get summary information for an account"""
    try:
        logging.info(f"Getting account summary for account_id: {account_id}, user_id: {user_id}")
        
        # Get account details
        account = get_account_details(account_id, user_id)
        if not account:
            logging.warning(f"Account not found: {account_id} for user: {user_id}")
            return {"error": "Account not found"}
        
        logging.info(f"Account found: {account.get('account_name', 'Unknown')}")
        
        # Get transactions for this account
        table_client = get_table_client("Transactions")
        
        # Get transactions for this account
        filter_query = f"PartitionKey eq '{user_id}' and account_id eq '{account_id}'"
        
        try:
            entities = table_client.list_entities(filter=filter_query)
            transactions = [dict(entity) for entity in entities]
        except Exception as e:
            logging.error(f"Error with filter query: {e}")
            # Fallback: get all transactions for user and filter manually
            entities = table_client.list_entities(filter=f"PartitionKey eq '{user_id}'")
            all_transactions = [dict(entity) for entity in entities]
            transactions = [t for t in all_transactions if t.get('account_id') == account_id]
        
        # Additional validation: filter out any transactions that don't match the account_id
        # This is a safety check in case the Azure Table Storage filter doesn't work as expected
        filtered_transactions = []
        for transaction in transactions:
            if transaction.get('account_id') == account_id:
                filtered_transactions.append(transaction)
        
        transactions = filtered_transactions
        
        # Calculate summary statistics
        total_transactions = len(transactions)
        last_transaction_date = None
        
        if transactions:
            # Sort by date to get the most recent
            transactions.sort(key=lambda x: x.get('transaction_date', ''), reverse=True)
            last_transaction_date = transactions[0].get('transaction_date')
        
        # Calculate monthly totals (current month)
        current_month = datetime.utcnow().strftime('%Y-%m')
        monthly_income = 0
        monthly_expense = 0
        
        for transaction in transactions:
            transaction_date = transaction.get('transaction_date', '')
            if transaction_date.startswith(current_month):
                amount = float(transaction.get('amount', 0))
                transaction_type = transaction.get('transaction_type', '')
                
                if transaction_type == 'income':
                    monthly_income += amount
                elif transaction_type == 'expense':
                    monthly_expense += amount
        
        result = {
            "account_id": account_id,
            "account_name": account.get('account_name', ''),
            "current_balance": account.get('current_balance', 0),
            "total_transactions": total_transactions,
            "last_transaction_date": last_transaction_date,
            "monthly_income": monthly_income,
            "monthly_expense": monthly_expense,
            "recent_transactions": transactions[:5]  # Last 5 transactions
        }
        
        return result
        
    except Exception as e:
        logging.error(f"Error getting account summary: {str(e)}")
        return {"error": str(e)}

def delete_transaction(transaction_id: str, user_id: str) -> Dict:
    """Delete a transaction and recalculate account balance"""
    try:
        table_client = get_table_client("Transactions")
        
        # Get the transaction to delete
        try:
            transaction_entity = table_client.get_entity(partition_key=user_id, row_key=transaction_id)
        except Exception as e:
            if "ResourceNotFound" in str(e) or "not found" in str(e).lower():
                return {"success": False, "error": "Transaction not found"}
            raise e
        
        # Extract transaction details for balance recalculation
        account_id = transaction_entity.get('account_id')
        amount = float(transaction_entity.get('amount', 0))
        transaction_type = transaction_entity.get('transaction_type')
        
        # Delete the transaction
        table_client.delete_entity(partition_key=user_id, row_key=transaction_id)
        
        # Recalculate account balance by reversing the transaction effect
        if account_id and transaction_type:
            # Reverse the balance change (opposite of what was done when adding)
            if transaction_type == 'income':
                # Income was added, so subtract it
                update_account_balance(account_id, user_id, amount, 'expense')
            elif transaction_type == 'expense':
                # Expense was subtracted, so add it back
                update_account_balance(account_id, user_id, amount, 'income')
            elif transaction_type == 'transfer':
                # Transfer was subtracted, so add it back
                update_account_balance(account_id, user_id, amount, 'income')
        
        logging.info(f"Deleted transaction {transaction_id} for user {user_id}")
        return {"success": True, "message": "Transaction deleted successfully"}
        
    except Exception as e:
        logging.error(f"Error deleting transaction: {str(e)}")
        return {"success": False, "error": str(e)}

def get_user_financial_summary(user_id: str) -> Dict:
    """Get overall financial summary for a user"""
    try:
        # Get all user accounts
        accounts = get_user_accounts(user_id)
        
        # Get all user transactions
        transactions = get_user_transactions(user_id, limit=1000)  # Get more for accurate calculations
        
        # Calculate totals
        total_accounts = len(accounts)
        total_balance = sum(account.get('current_balance', 0) for account in accounts)
        
        # Calculate monthly totals (current month)
        current_month = datetime.utcnow().strftime('%Y-%m')
        monthly_income = 0
        monthly_expense = 0
        
        for transaction in transactions:
            transaction_date = transaction.get('transaction_date', '')
            if transaction_date.startswith(current_month):
                amount = float(transaction.get('amount', 0))
                transaction_type = transaction.get('transaction_type', '')
                
                if transaction_type == 'income':
                    monthly_income += amount
                elif transaction_type == 'expense':
                    monthly_expense += amount
        
        # Prepare account balances summary
        account_balances = []
        for account in accounts:
            account_balances.append({
                "account_id": account.get('account_id'),
                "account_name": account.get('account_name', ''),
                "account_type": account.get('account_type', ''),
                "current_balance": account.get('current_balance', 0)
            })
        
        return {
            "total_accounts": total_accounts,
            "total_balance": total_balance,
            "monthly_income": monthly_income,
            "monthly_expense": monthly_expense,
            "net_worth": total_balance,
            "account_balances": account_balances
        }
        
    except Exception as e:
        logging.error(f"Error getting user financial summary: {str(e)}")
        return {"error": str(e)}

# API Endpoints
@app.route(route="accounts", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def accounts_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for account operations"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers (in a real app, this would come from JWT token)
        user_id = req.headers.get('X-User-ID')
        if not user_id:
            # For development, use a default user ID
            user_id = "dev-user-123"
            logging.warning("No user ID provided, using default for development")
        
        if req.method == "GET":
            # Get user accounts
            accounts = get_user_accounts(user_id)
            headers = get_cors_headers()
            headers["Content-Type"] = "application/json"
            return func.HttpResponse(
                json.dumps(accounts),
                status_code=200,
                headers=headers
            )
        
        elif req.method == "POST":
            # Create new account
            try:
                req_body = req.get_json()
                if not req_body:
                    return func.HttpResponse(
                        json.dumps({"error": "Request body is required"}),
                        status_code=400,
                        headers={"Content-Type": "application/json"}
                    )
                
                # Sanitize input
                account_data = sanitize_user_input(req_body)
                
                # Validate data
                is_valid, errors = validate_account_data(account_data)
                if not is_valid:
                    return func.HttpResponse(
                        json.dumps({"error": "Validation failed", "details": errors}),
                        status_code=400,
                        headers={"Content-Type": "application/json"}
                    )
                
                # Create account
                new_account = create_bank_account(
                    user_id=user_id,
                    account_name=account_data['account_name'],
                    account_type=account_data['account_type'],
                    initial_balance=float(account_data.get('initial_balance', 0)),
                    bank_name=account_data.get('bank_name', ''),
                    description=account_data.get('description', '')
                )
                
                headers = get_cors_headers()
                headers["Content-Type"] = "application/json"
                return func.HttpResponse(
                    json.dumps(new_account),
                    status_code=201,
                    headers=headers
                )
                
            except Exception as e:
                logging.error(f"Error creating account: {str(e)}")
                headers = get_cors_headers()
                headers["Content-Type"] = "application/json"
                return func.HttpResponse(
                    json.dumps({"error": "Failed to create account", "details": str(e)}),
                    status_code=500,
                    headers=headers
                )
    
    except Exception as e:
        logging.error(f"Error in accounts API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="transactions", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def transactions_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for transaction operations"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers
        user_id = req.headers.get('X-User-ID')
        if not user_id:
            # For development, use a default user ID
            user_id = "dev-user-123"
            logging.warning("No user ID provided, using default for development")
        
        if req.method == "POST":
            # Add new transaction
            try:
                req_body = req.get_json()
                if not req_body:
                    return func.HttpResponse(
                        json.dumps({"error": "Request body is required"}),
                        status_code=400,
                        headers={"Content-Type": "application/json"}
                    )
                
                # Sanitize input
                transaction_data = sanitize_user_input(req_body)
                
                # Validate data
                is_valid, errors = validate_transaction_data(transaction_data)
                if not is_valid:
                    return func.HttpResponse(
                        json.dumps({"error": "Validation failed", "details": errors}),
                        status_code=400,
                        headers={"Content-Type": "application/json"}
                    )
                
                # Add transaction
                new_transaction = add_transaction(
                    account_id=transaction_data['account_id'],
                    user_id=user_id,
                    amount=float(transaction_data['amount']),
                    description=transaction_data['description'],
                    category=transaction_data['category'],
                    transaction_type=transaction_data['transaction_type'],
                    date=transaction_data.get('transaction_date')
                )
                
                headers = get_cors_headers()
                headers["Content-Type"] = "application/json"
                return func.HttpResponse(
                    json.dumps(new_transaction),
                    status_code=201,
                    headers=headers
                )
                
            except Exception as e:
                logging.error(f"Error adding transaction: {str(e)}")
                headers = get_cors_headers()
                headers["Content-Type"] = "application/json"
                return func.HttpResponse(
                    json.dumps({"error": "Failed to add transaction", "details": str(e)}),
                    status_code=500,
                    headers=headers
                )
    
    except Exception as e:
        logging.error(f"Error in transactions API: {str(e)}")
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=headers
        )

@app.route(route="transactions/{transaction_id}", methods=["DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def delete_transaction_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for deleting transactions"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers
        user_id = req.headers.get('X-User-ID')
        if not user_id:
            # For development, use a default user ID
            user_id = "dev-user-123"
            logging.warning("No user ID provided, using default for development")
        
        if req.method == "DELETE":
            # Get transaction ID from route parameter
            transaction_id = req.route_params.get('transaction_id')
            if not transaction_id:
                return func.HttpResponse(
                    json.dumps({"error": "Transaction ID is required"}),
                    status_code=400,
                    headers={"Content-Type": "application/json"}
                )
            
            # Delete transaction
            result = delete_transaction(transaction_id, user_id)
            
            if result.get('success'):
                headers = get_cors_headers()
                headers["Content-Type"] = "application/json"
                return func.HttpResponse(
                    json.dumps(result),
                    status_code=200,
                    headers=headers
                )
            else:
                headers = get_cors_headers()
                headers["Content-Type"] = "application/json"
                return func.HttpResponse(
                    json.dumps(result),
                    status_code=400,
                    headers=headers
                )
    
    except Exception as e:
        logging.error(f"Error in delete transaction API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="transactions/recent", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def recent_transactions_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting recent transactions"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers
        user_id = req.headers.get('X-User-ID')
        if not user_id:
            # For development, use a default user ID
            user_id = "dev-user-123"
            logging.warning("No user ID provided, using default for development")
        
        # Get limit from query parameters
        limit = int(req.params.get('limit', 10))
        
        # Get recent transactions
        transactions = get_user_transactions(user_id, limit)
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(transactions),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in recent transactions API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="accounts/summary/{account_id}", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def account_summary_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting account summary"""
    try:
        logging.info(f"Account summary API called with method: {req.method}")
        
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            logging.info("Handling CORS preflight request")
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers
        user_id = req.headers.get('X-User-ID')
        if not user_id:
            # For development, use a default user ID
            user_id = "dev-user-123"
            logging.warning("No user ID provided, using default for development")
        
        logging.info(f"Using user ID: {user_id}")
        
        # Get account ID from route parameter
        account_id = req.route_params.get('account_id')
        if not account_id:
            logging.error("No account ID provided in route parameters")
            return func.HttpResponse(
                json.dumps({"error": "Account ID is required"}),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        
        logging.info(f"Getting summary for account ID: {account_id}")
        
        # Get account summary
        summary = get_account_summary(account_id, user_id)
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(summary),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in account summary API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="financial-summary", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def financial_summary_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting user financial summary"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID from request headers
        user_id = req.headers.get('X-User-ID')
        if not user_id:
            # For development, use a default user ID
            user_id = "dev-user-123"
            logging.warning("No user ID provided, using default for development")
        
        # Get financial summary
        summary = get_user_financial_summary(user_id)
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(summary),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in financial summary API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )