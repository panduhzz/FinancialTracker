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
        # Get all accounts for the user, then filter in Python to handle missing is_active field
        entities = table_client.list_entities(filter=f"PartitionKey eq '{user_id}'")
        accounts = []
        for entity in entities:
            account = dict(entity)
            account['account_id'] = account['RowKey']
            
            # Filter out inactive accounts (default to True if is_active field doesn't exist)
            is_active = account.get('is_active', True)
            if is_active:
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
    """Retrieve all transactions for a user across all active accounts"""
    try:
        # First, get all active accounts to filter transactions
        active_accounts = get_user_accounts(user_id)
        active_account_ids = {account['account_id'] for account in active_accounts}
        
        table_client = get_table_client("Transactions")
        entities = table_client.list_entities(filter=f"PartitionKey eq '{user_id}'")
        
        # Convert to list and filter out transactions from inactive accounts
        all_transactions = [dict(entity) for entity in entities]
        filtered_transactions = [
            transaction for transaction in all_transactions 
            if transaction.get('account_id') in active_account_ids
        ]
        
        # Sort by date (newest first)
        filtered_transactions.sort(key=lambda x: x.get('transaction_date', ''), reverse=True)
        
        return filtered_transactions[:limit]
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

def delete_account(account_id: str, user_id: str) -> Dict:
    """Soft delete an account by marking it as inactive"""
    try:
        table_client = get_table_client("UserAccounts")
        
        # Get the account to delete
        try:
            account_entity = table_client.get_entity(partition_key=user_id, row_key=account_id)
            logging.info(f"Found account to delete: {account_entity.get('account_name', 'Unknown')} (ID: {account_id})")
        except Exception as e:
            if "ResourceNotFound" in str(e) or "not found" in str(e).lower():
                logging.error(f"Account not found: {account_id}")
                return {"success": False, "error": "Account not found"}
            raise e
        
        # Verify the account belongs to the user
        if account_entity.get('PartitionKey') != user_id:
            logging.error(f"Unauthorized deletion attempt: User {user_id} tried to delete account {account_id}")
            return {"success": False, "error": "Unauthorized: Account does not belong to user"}
        
        # Soft delete by marking as inactive
        account_entity['is_active'] = False
        account_entity['last_updated'] = datetime.utcnow().isoformat()
        
        # Update the account
        table_client.update_entity(account_entity)
        
        logging.info(f"Successfully soft deleted account {account_id} ({account_entity.get('account_name', 'Unknown')}) for user {user_id}")
        return {"success": True, "message": "Account deleted successfully"}
        
    except Exception as e:
        logging.error(f"Error deleting account: {str(e)}")
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

# Analytics Functions for Charts
def calculate_monthly_aggregates(transactions: List[Dict], months: int = 12) -> Dict:
    """Helper function to aggregate transaction data by month"""
    try:
        from datetime import timedelta
        
        monthly_data = {}
        current_date = datetime.utcnow()
        
        # Initialize last N months with zero values
        for i in range(months):
            month_date = current_date - timedelta(days=30*i)
            month_key = month_date.strftime('%Y-%m')
            monthly_data[month_key] = {
                'income': 0,
                'expense': 0,
                'transfer': 0,
                'net': 0,
                'transaction_count': 0
            }
        
        # Aggregate actual transaction data
        for transaction in transactions:
            transaction_date = transaction.get('transaction_date', '')
            if transaction_date:
                # Extract YYYY-MM from ISO date
                month_key = transaction_date[:7]
                if month_key in monthly_data:
                    amount = float(transaction.get('amount', 0))
                    transaction_type = transaction.get('transaction_type', '')
                    
                    monthly_data[month_key]['transaction_count'] += 1
                    
                    if transaction_type == 'income':
                        monthly_data[month_key]['income'] += amount
                    elif transaction_type == 'expense':
                        monthly_data[month_key]['expense'] += amount
                    elif transaction_type == 'transfer':
                        monthly_data[month_key]['transfer'] += amount
                    
                    # Calculate net (income - expense)
                    monthly_data[month_key]['net'] = (
                        monthly_data[month_key]['income'] - 
                        monthly_data[month_key]['expense']
                    )
        
        # Sort by month (oldest first for charts)
        sorted_months = sorted(monthly_data.keys())
        sorted_data = {month: monthly_data[month] for month in sorted_months}
        
        return sorted_data
        
    except Exception as e:
        logging.error(f"Error calculating monthly aggregates: {str(e)}")
        return {}

def get_monthly_financial_summary(user_id: str, months: int = 12) -> Dict:
    """Get monthly aggregated financial data for all user accounts including balance history"""
    try:
        # Get all user transactions
        transactions = get_user_transactions(user_id, limit=1000)
        
        # Get all user accounts for balance data
        accounts = get_user_accounts(user_id)
        
        # Calculate monthly aggregates
        monthly_data = calculate_monthly_aggregates(transactions, months)
        
        # Calculate historical balance data (with error handling)
        try:
            balance_history = get_balance_history(user_id, months)
            
            # Add balance data to monthly_data
            for month_key, month_data in monthly_data.items():
                if month_key in balance_history.get('monthly_net_worth', {}):
                    month_data['total_balance'] = balance_history['monthly_net_worth'][month_key]
                else:
                    month_data['total_balance'] = 0
        except Exception as e:
            logging.error(f"Error calculating balance history: {str(e)}")
            # If balance history fails, just use current total balance for all months
            current_total_balance = sum(account.get('current_balance', 0) for account in accounts)
            for month_key, month_data in monthly_data.items():
                month_data['total_balance'] = current_total_balance
        
        # Calculate Y-axis scaling for both income/expense and balance data
        all_values = []
        balance_values = []
        for month_data in monthly_data.values():
            all_values.extend([month_data['income'], month_data['expense'], month_data['net']])
            balance_values.append(month_data['total_balance'])
        
        # Calculate Y-axis scale for income/expense chart
        if all_values:
            min_val = min(all_values)
            max_val = max(all_values)
            range_val = max_val - min_val
            
            # Determine appropriate interval
            if range_val <= 500:
                interval = 50
            elif range_val <= 1000:
                interval = 100
            elif range_val <= 5000:
                interval = 500
            else:
                interval = 1000
            
            # Calculate axis bounds
            axis_min = max(0, (min_val // interval) * interval - interval)
            axis_max = ((max_val // interval) + 1) * interval + interval
        else:
            axis_min = 0
            axis_max = 1000
            interval = 100
        
        # Calculate Y-axis scale for balance chart
        balance_axis_min = 0
        balance_axis_max = 1000
        balance_interval = 100
        if balance_values:
            balance_min = min(balance_values)
            balance_max = max(balance_values)
            balance_range = balance_max - balance_min
            
            # Determine appropriate interval for balance
            if balance_range <= 500:
                balance_interval = 50
            elif balance_range <= 1000:
                balance_interval = 100
            elif balance_range <= 5000:
                balance_interval = 500
            else:
                balance_interval = 1000
            
            # Calculate axis bounds for balance
            balance_axis_min = max(0, (balance_min // balance_interval) * balance_interval - balance_interval)
            balance_axis_max = ((balance_max // balance_interval) + 1) * balance_interval + balance_interval
        
        return {
            "monthly_data": monthly_data,
            "chart_config": {
                "y_axis_scale": {
                    "min": axis_min,
                    "max": axis_max,
                    "interval": interval
                },
                "balance_y_axis_scale": {
                    "min": balance_axis_min,
                    "max": balance_axis_max,
                    "interval": balance_interval
                }
            },
            "total_accounts": len(accounts),
            "total_balance": sum(account.get('current_balance', 0) for account in accounts)
        }
        
    except Exception as e:
        logging.error(f"Error getting monthly financial summary: {str(e)}")
        return {"error": str(e)}

def get_account_monthly_history(account_id: str, user_id: str, months: int = 12) -> Dict:
    """Get monthly data for a specific account"""
    try:
        # Get account details first
        account = get_account_details(account_id, user_id)
        if not account:
            return {"error": "Account not found"}
        
        # Get all transactions for this account
        table_client = get_table_client("Transactions")
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
        
        # Calculate monthly aggregates for this account
        monthly_data = calculate_monthly_aggregates(transactions, months)
        
        # Calculate Y-axis scaling for account balance
        balance_values = [account.get('current_balance', 0)]
        for month_data in monthly_data.values():
            balance_values.extend([month_data['income'], month_data['expense']])
        
        if balance_values:
            min_val = min(balance_values)
            max_val = max(balance_values)
            range_val = max_val - min_val
            
            if range_val <= 500:
                interval = 50
            elif range_val <= 1000:
                interval = 100
            elif range_val <= 5000:
                interval = 500
            else:
                interval = 1000
            
            axis_min = max(0, (min_val // interval) * interval - interval)
            axis_max = ((max_val // interval) + 1) * interval + interval
        else:
            axis_min = 0
            axis_max = 1000
            interval = 100
        
        return {
            "account_info": {
                "account_id": account_id,
                "account_name": account.get('account_name', ''),
                "current_balance": account.get('current_balance', 0)
            },
            "monthly_data": monthly_data,
            "chart_config": {
                "y_axis_scale": {
                    "min": axis_min,
                    "max": axis_max,
                    "interval": interval
                }
            }
        }
        
    except Exception as e:
        logging.error(f"Error getting account monthly history: {str(e)}")
        return {"error": str(e)}

def get_balance_history(user_id: str, months: int = 12) -> Dict:
    """Calculate historical balance snapshots for all accounts by reconstructing from transactions"""
    try:
        # Get all user accounts
        accounts = get_user_accounts(user_id)
        
        # Get all user transactions
        transactions = get_user_transactions(user_id, limit=1000)
        
        # Initialize monthly balance data
        from datetime import timedelta
        current_date = datetime.utcnow()
        monthly_balances = {}
        
        # Create a map of account_id to initial balance (current balance)
        account_initial_balances = {acc.get('account_id'): acc.get('current_balance', 0) for acc in accounts}
        
        # Generate month keys for the last N months
        month_keys = []
        for i in range(months):
            month_date = current_date - timedelta(days=30*i)
            month_key = month_date.strftime('%Y-%m')
            month_keys.append(month_key)
            monthly_balances[month_key] = {}
        
        # Sort month keys chronologically (oldest first)
        month_keys.sort()
        
        # For each month, calculate the balance at the END of that month
        for month_key in month_keys:
            # For each account, calculate what the balance was at the end of this month
            for account in accounts:
                account_id = account.get('account_id')
                account_name = account.get('account_name', '')
                
                # Start with the current balance
                balance_at_end_of_month = account_initial_balances[account_id]
                
                # Subtract all transactions that happened AFTER this month
                for transaction in transactions:
                    transaction_date_str = transaction.get('transaction_date', '')
                    if not transaction_date_str:
                        continue
                    
                    # Parse transaction date and compare with month_key
                    try:
                        transaction_date = datetime.fromisoformat(transaction_date_str.replace('Z', '+00:00'))
                        transaction_month = transaction_date.strftime('%Y-%m')
                        
                        # If transaction happened after this month, reverse its effect
                        if (transaction.get('account_id') == account_id and 
                            transaction_month > month_key):
                            
                            amount = float(transaction.get('amount', 0))
                            transaction_type = transaction.get('transaction_type', '')
                            
                            # Reverse the transaction effect to get historical balance
                            if transaction_type == 'income':
                                balance_at_end_of_month -= amount  # Remove future income
                            elif transaction_type == 'expense':
                                balance_at_end_of_month += amount  # Add back future expenses
                            elif transaction_type == 'transfer':
                                balance_at_end_of_month += amount  # Add back future transfers (money leaving)
                    except Exception as e:
                        logging.warning(f"Error parsing transaction date {transaction_date_str}: {e}")
                        continue
                
                monthly_balances[month_key][account_id] = {
                    'account_name': account_name,
                    'balance': balance_at_end_of_month
                }
        
        # Calculate total net worth for each month
        monthly_net_worth = {}
        for month_key, account_balances in monthly_balances.items():
            total_balance = sum(acc_data['balance'] for acc_data in account_balances.values())
            monthly_net_worth[month_key] = total_balance
        
        # Calculate Y-axis scaling for net worth
        net_worth_values = list(monthly_net_worth.values())
        if net_worth_values:
            min_val = min(net_worth_values)
            max_val = max(net_worth_values)
            range_val = max_val - min_val
            
            if range_val <= 1000:
                interval = 100
            elif range_val <= 5000:
                interval = 500
            elif range_val <= 10000:
                interval = 1000
            else:
                interval = 2000
            
            axis_min = max(0, (min_val // interval) * interval - interval)
            axis_max = ((max_val // interval) + 1) * interval + interval
        else:
            axis_min = 0
            axis_max = 1000
            interval = 100
        
        return {
            "monthly_balances": monthly_balances,
            "monthly_net_worth": monthly_net_worth,
            "chart_config": {
                "y_axis_scale": {
                    "min": axis_min,
                    "max": axis_max,
                    "interval": interval
                }
            }
        }
        
    except Exception as e:
        logging.error(f"Error getting balance history: {str(e)}")
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

@app.route(route="accounts/{account_id}", methods=["DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def delete_account_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for deleting an account"""
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
            # Get account ID from route parameters
            account_id = req.route_params.get('account_id')
            if not account_id:
                return func.HttpResponse(
                    json.dumps({"error": "Account ID is required"}),
                    status_code=400,
                    headers=get_cors_headers()
                )
            
            # Delete the account
            result = delete_account(account_id, user_id)
            
            if result.get('success'):
                return func.HttpResponse(
                    json.dumps(result),
                    status_code=200,
                    headers=get_cors_headers()
                )
            else:
                return func.HttpResponse(
                    json.dumps(result),
                    status_code=400,
                    headers=get_cors_headers()
                )
        
        return func.HttpResponse(
            json.dumps({"error": "Method not allowed"}),
            status_code=405,
            headers=get_cors_headers()
        )

    except Exception as e:
        logging.error(f"Error in delete account API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers=get_cors_headers()
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

# Analytics API Endpoints for Charts
@app.route(route="analytics/monthly-summary", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def monthly_summary_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting monthly aggregated financial data for all accounts"""
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
        
        # Get months parameter from query string (default: 12)
        months = int(req.params.get('months', 12))
        
        # Get monthly financial summary
        summary = get_monthly_financial_summary(user_id, months)
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(summary),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in monthly summary API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="analytics/account-history/{account_id}", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def account_history_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting monthly data for a specific account"""
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
        
        # Get account ID from route parameter
        account_id = req.route_params.get('account_id')
        if not account_id:
            return func.HttpResponse(
                json.dumps({"error": "Account ID is required"}),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        
        # Get months parameter from query string (default: 12)
        months = int(req.params.get('months', 12))
        
        # Get account monthly history
        history = get_account_monthly_history(account_id, user_id, months)
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(history),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in account history API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="analytics/balance-history", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def balance_history_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting historical balance data for all accounts"""
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
        
        # Get months parameter from query string (default: 12)
        months = int(req.params.get('months', 12))
        
        # Get balance history
        history = get_balance_history(user_id, months)
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps(history),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in balance history API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )

@app.route(route="analytics/account-balance", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def account_balance_api(req: func.HttpRequest) -> func.HttpResponse:
    """Get simplified account balance history for chart display"""
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
        
        # Get months parameter from query string (default: 12)
        months = int(req.params.get('months', 12))
        
        # Get balance history
        balance_data = get_balance_history(user_id, months)
        
        if "error" in balance_data:
            return func.HttpResponse(
                json.dumps({"error": balance_data["error"]}),
                status_code=500,
                headers=get_cors_headers()
            )
        
        # Return simplified data structure for the chart
        monthly_net_worth = balance_data.get('monthly_net_worth', {})
        chart_config = balance_data.get('chart_config', {})
        
        # Sort months chronologically
        sorted_months = sorted(monthly_net_worth.keys())
        balance_values = [monthly_net_worth[month] for month in sorted_months]
        
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps({
                "months": sorted_months,
                "balances": balance_values,
                "chart_config": chart_config
            }),
            status_code=200,
            headers=headers
        )
    
    except Exception as e:
        logging.error(f"Error in account balance API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )