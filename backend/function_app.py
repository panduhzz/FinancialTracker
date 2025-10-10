import azure.functions as func
from azure.data.tables import TableServiceClient, TableEntity
import logging
import os
import json
import uuid
import jwt
import requests
import calendar
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@app.route(route="test")
def test(req: func.HttpRequest) -> func.HttpResponse:
    try:
        # Check if this is production environment
        environment = os.environ.get("ENVIRONMENT", "development")
        if environment.lower() == "production":
            return func.HttpResponse(
                "This endpoint is not available in production",
                status_code=403
            )
        
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

# Authentication and Token Validation Functions
def get_azure_b2c_public_keys():
    """Get Azure AD B2C public keys for token validation"""
    try:
        # Azure AD B2C OpenID Connect metadata endpoint
        # Replace with your actual B2C tenant and policy
        metadata_url = "https://PanduhzProject.b2clogin.com/PanduhzProject.onmicrosoft.com/B2C_1_testonsiteflow/v2.0/.well-known/openid_configuration"
        
        response = requests.get(metadata_url, timeout=10)
        response.raise_for_status()
        
        metadata = response.json()
        jwks_url = metadata['jwks_uri']
        
        jwks_response = requests.get(jwks_url, timeout=10)
        jwks_response.raise_for_status()
        
        return jwks_response.json()
    except Exception as e:
        logging.error(f"Error fetching Azure B2C public keys: {str(e)}")
        return None

def validate_token(req: func.HttpRequest) -> str:
    """Validate Azure AD B2C token and return user ID"""
    try:
        # Get token from Authorization header
        auth_header = req.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            raise ValueError("Invalid authorization header")
        
        token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        # For development/testing, we'll do basic token validation
        # In production, you should implement full JWT signature verification
        try:
            # Decode token without verification for development
            # In production, use proper JWT verification with public keys
            decoded_token = jwt.decode(token, options={"verify_signature": False})
            
            
            # Extract user ID from token
            user_id = decoded_token.get('oid') or decoded_token.get('sub')
            if not user_id:
                raise ValueError("No user ID found in token")
            
            # Basic token validation
            if 'exp' in decoded_token:
                exp_timestamp = decoded_token['exp']
                current_timestamp = datetime.utcnow().timestamp()
                if current_timestamp > exp_timestamp:
                    raise ValueError("Token has expired")
            
            return user_id
            
        except jwt.InvalidTokenError as e:
            logging.error(f"Invalid JWT token: {str(e)}")
            raise ValueError("Invalid token format")
            
    except Exception as e:
        logging.error(f"Token validation failed: {str(e)}")
        raise ValueError("Token validation failed")

def get_user_id_from_request(req: func.HttpRequest) -> str:
    """Get user ID from request - supports both token validation and fallback to headers for development"""
    try:
        # Try token validation first
        return validate_token(req)
    except Exception as token_error:
        logging.warning(f"Token validation failed: {str(token_error)}")
        
        # For development, try to extract user ID from token even if validation fails
        auth_header = req.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                token = auth_header[7:]  # Remove 'Bearer ' prefix
                # Decode token without verification for development
                decoded_token = jwt.decode(token, options={"verify_signature": False})
                
                # Try different possible user ID fields
                user_id = (decoded_token.get('oid') or 
                          decoded_token.get('sub') or 
                          decoded_token.get('objectId') or
                          decoded_token.get('userId'))
                
                if user_id:
                    return user_id
                else:
                    logging.error(f"No user ID found in token. Available claims: {list(decoded_token.keys())}")
            except Exception as decode_error:
                logging.warning(f"Failed to decode token: {str(decode_error)}")
        
        # Fallback to header for development (remove this in production)
        user_id = req.headers.get('X-User-ID')
        if user_id:
            logging.warning("Using X-User-ID header as fallback - this should be removed in production")
            return user_id
        
        # If no valid authentication method, raise error
        raise ValueError("No valid authentication provided")

# Utility Functions
def handle_first_time_user_error(error_message: str, user_id: str, operation: str) -> bool:
    """Check if error is due to first-time user (missing tables) and handle gracefully"""
    error_lower = error_message.lower()
    if any(phrase in error_lower for phrase in [
        "table specified does not exist",
        "not found",
        "table not found",
        "resource not found"
    ]):
        logging.info(f"First-time user detected for {operation}: {user_id}. Tables will be created automatically.")
        return True
    return False

def get_table_service_client():
    """Get table service client using connection string from environment"""
    connection_string = os.environ.get("AZURITE_CONNECTION_STRING")
    if not connection_string:
        raise Exception("AZURITE_CONNECTION_STRING environment variable not set")
    return TableServiceClient.from_connection_string(connection_string)

def ensure_tables_exist():
    """Create all required tables if they don't exist"""
    try:
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
                    # Don't raise the error, just log it and continue
                    # This allows the application to continue even if table creation fails
                    pass
        
        return created_tables
    except Exception as e:
        logging.error(f"Error in ensure_tables_exist: {str(e)}")
        # Don't raise the error, just log it
        # This allows the application to continue even if table service is unavailable
        return []

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
    
    # Validate account creation date if provided
    account_creation_date = account_data.get('account_creation_date')
    if account_creation_date:
        try:
            creation_date = datetime.fromisoformat(account_creation_date.replace('Z', '+00:00'))
            # Check if date is in the future
            if creation_date > datetime.utcnow():
                errors.append("Account creation date cannot be in the future")
        except (ValueError, TypeError):
            errors.append("Invalid account creation date format")
    
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
    
    # Validate recurring transaction fields
    is_recurring = transaction_data.get('is_recurring', False)
    if is_recurring:
        if not transaction_data.get('recurring_start_date'):
            errors.append("Recurring start date is required for recurring transactions")
        if not transaction_data.get('recurring_frequency'):
            errors.append("Recurring frequency is required for recurring transactions")
        elif transaction_data.get('recurring_frequency') not in ['monthly', 'yearly']:
            errors.append("Invalid recurring frequency. Must be 'monthly' or 'yearly'")
    
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
                       description: str = "", account_creation_date: str = None) -> Dict:
    """Create a new bank account for a user"""
    try:
        # Ensure tables exist
        ensure_tables_exist()
        
        # Generate unique account ID
        account_id = str(uuid.uuid4())
        
        # Handle account creation date
        if account_creation_date:
            try:
                # Validate and parse the date
                creation_date = datetime.fromisoformat(account_creation_date.replace('Z', '+00:00'))
                # Ensure the date is not in the future
                if creation_date > datetime.utcnow():
                    creation_date = datetime.utcnow()
                created_date_str = creation_date.isoformat()
            except (ValueError, TypeError):
                # If date parsing fails, use current time
                created_date_str = datetime.utcnow().isoformat()
        else:
            created_date_str = datetime.utcnow().isoformat()
        
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
            'created_date': created_date_str,
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
        # Ensure tables exist before trying to query them
        ensure_tables_exist()
        
        table_client = get_table_client("UserAccounts")
        
        # Get all accounts for the user, then filter in Python to handle missing is_active field
        entities = table_client.list_entities()
        # Convert iterator to list immediately to avoid paging issues
        entities = list(entities)
        
        # Filter by user ID in Python
        user_entities = [entity for entity in entities if entity.get('PartitionKey') == user_id]
        entities = user_entities
        
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
        # For first-time users, return empty list instead of raising error
        if handle_first_time_user_error(str(e), user_id, "get_user_accounts"):
            return []
        raise e

def add_transaction(account_id: str, user_id: str, amount: float, description: str, 
                   category: str, transaction_type: str, date: Optional[str] = None,
                   is_recurring: bool = False, recurring_frequency: str = "monthly",
                   recurring_start_date: Optional[str] = None) -> Dict:
    """Add a new transaction to an account"""
    try:
        # Ensure tables exist
        ensure_tables_exist()
        
        # Generate unique transaction ID
        transaction_id = str(uuid.uuid4())
        
        # Use current date if not provided
        if not date:
            date = datetime.utcnow().isoformat()
        
        # Ensure date is in proper format (YYYY-MM-DD) and avoid timezone issues
        if date and 'T' not in date:
            # If it's just a date string, ensure it's properly formatted
            try:
                # Parse and reformat to ensure consistency
                parsed_date = datetime.strptime(date, '%Y-%m-%d')
                # Store as date string without time to avoid timezone conversion
                date = parsed_date.strftime('%Y-%m-%d')
            except ValueError:
                logging.error(f"Invalid date format: {date}")
                date = datetime.utcnow().strftime('%Y-%m-%d')
        elif date and 'T' in date:
            # If it's an ISO datetime string, extract just the date part
            try:
                parsed_date = datetime.fromisoformat(date.replace('Z', '+00:00'))
                date = parsed_date.strftime('%Y-%m-%d')
            except ValueError:
                logging.error(f"Invalid ISO date format: {date}")
                date = datetime.utcnow().strftime('%Y-%m-%d')
        
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
            'is_recurring': is_recurring,
            'recurring_frequency': recurring_frequency if is_recurring else None,
            'recurring_start_date': recurring_start_date if is_recurring else None,
            'created_date': datetime.utcnow().isoformat(),
            'last_updated': datetime.utcnow().isoformat()
        }
        
        # Save to table
        table_client = get_table_client("Transactions")
        table_client.create_entity(transaction_entity)
        
        # Update account balance (pass transaction type)
        update_account_balance(account_id, user_id, amount, transaction_type)
        
        # If this is a recurring transaction, process historical transactions
        if is_recurring and recurring_start_date:
            try:
                logging.info(f"Processing recurring transaction history for {transaction_id}")
                process_recurring_transaction_history(
                    account_id, user_id, amount, description, category, 
                    transaction_type, recurring_start_date, recurring_frequency
                )
                logging.info(f"Successfully processed historical transactions for recurring transaction {transaction_id}")
            except Exception as e:
                logging.error(f"Error processing historical transactions for {transaction_id}: {str(e)}")
                # Don't fail the main transaction if historical processing fails
                # The main transaction was already created successfully
        
        logging.info(f"Created transaction {transaction_id} for account {account_id}")
        return transaction_entity
        
    except Exception as e:
        logging.error(f"Error adding transaction: {str(e)}")
        raise e

def process_recurring_transaction_history(account_id: str, user_id: str, amount: float,
                                        description: str, category: str, transaction_type: str,
                                        start_date: str, frequency: str) -> List[Dict]:
    """Create historical transactions for a recurring transaction"""
    try:
        # Parse start date - handle different date formats
        if 'T' in start_date:
            start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        else:
            # Handle YYYY-MM-DD format
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
        
        current_dt = datetime.utcnow()
        
        # Calculate months between start date and today
        months_passed = (current_dt.year - start_dt.year) * 12 + (current_dt.month - start_dt.month)
        
        # Don't create historical transactions if start date is in the future
        if months_passed < 0:
            logging.info(f"No historical transactions needed - start date is in the future")
            return []
        
        # If start date is in current month, don't create historical transactions
        # because the main transaction will be created for this month
        if months_passed == 0:
            logging.info(f"Start date is in current month - no historical transactions needed")
            return []
        
        created_transactions = []
        table_client = get_table_client("Transactions")
        
        # Create individual transactions for each month
        
        # Create transactions for each month AFTER the start month
        for i in range(1, months_passed + 1):
            # Calculate the date for this month using a safer method
            year = start_dt.year
            month = start_dt.month + i
            
            # Handle year overflow
            while month > 12:
                month -= 12
                year += 1
            
            # Create transaction date preserving the original day of the month
            # Handle cases where the day doesn't exist in the target month (e.g., Jan 31 -> Feb 28/29)
            try:
                transaction_date = datetime(year, month, start_dt.day)
            except ValueError:
                # If the day doesn't exist in the target month, use the last day of the month
                last_day = calendar.monthrange(year, month)[1]
                transaction_date = datetime(year, month, last_day)
            
            # Skip if this would be in the future
            # Allow current month if the day has already passed
            if transaction_date > current_dt:
                break
            
            # Generate unique transaction ID for historical transaction
            historical_transaction_id = str(uuid.uuid4())
            
            # Create historical transaction entity
            historical_transaction = {
                'PartitionKey': user_id,
                'RowKey': historical_transaction_id,
                'account_id': account_id,
                'amount': amount,
                'description': description,
                'category': category,
                'transaction_type': transaction_type,
                'transaction_date': transaction_date.isoformat(),
                'is_recurring': True,
                'recurring_frequency': frequency,
                'recurring_start_date': start_date,
                'created_date': datetime.utcnow().isoformat(),
                'last_updated': datetime.utcnow().isoformat()
            }
            
            # Save historical transaction
            table_client.create_entity(historical_transaction)
            
            # Update account balance for this historical transaction
            update_account_balance(account_id, user_id, amount, transaction_type)
            
            created_transactions.append(historical_transaction)
        
        logging.info(f"Created {len(created_transactions)} historical transactions for recurring transaction")
        return created_transactions
        
    except Exception as e:
        logging.error(f"Error processing recurring transaction history: {str(e)}")
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
        # Ensure tables exist before trying to query them
        ensure_tables_exist()
        
        # First, get all active accounts to filter transactions
        active_accounts = get_user_accounts(user_id)
        active_account_ids = {account['account_id'] for account in active_accounts}
        
        table_client = get_table_client("Transactions")
        entities = table_client.list_entities()
        
        # Convert to list and filter by user ID and active accounts
        all_transactions = [dict(entity) for entity in entities if entity.get('PartitionKey') == user_id]
        filtered_transactions = [
            transaction for transaction in all_transactions 
            if transaction.get('account_id') in active_account_ids
        ]
        
        # Sort by date (newest first)
        filtered_transactions.sort(key=lambda x: x.get('transaction_date', ''), reverse=True)
        
        return filtered_transactions[:limit]
    except Exception as e:
        logging.error(f"Error getting user transactions: {str(e)}")
        # For first-time users, return empty list instead of raising error
        if handle_first_time_user_error(str(e), user_id, "get_user_transactions"):
            return []
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
        
        # Get account details
        account = get_account_details(account_id, user_id)
        if not account:
            return {"error": "Account not found"}
        
        
        # Get transactions for this account
        table_client = get_table_client("Transactions")
        
        # Get transactions for this account
        entities = table_client.list_entities()
        all_transactions = [dict(entity) for entity in entities if entity.get('PartitionKey') == user_id]
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
        # Ensure tables exist before trying to query them
        ensure_tables_exist()
        
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
        # Ensure tables exist before trying to query them
        ensure_tables_exist()
        
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
        
        # Get all transactions for user and filter manually to avoid Azure SDK filter issues
        entities = table_client.list_entities()
        all_transactions = [dict(entity) for entity in entities if entity.get('PartitionKey') == user_id]
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

def search_transactions(user_id: str, description: str = None, category: str = None, 
                       start_date: str = None, end_date: str = None, 
                       transaction_type: str = None, limit: int = 100) -> Dict:
    """Search transactions with various filters"""
    try:
        # Ensure tables exist
        ensure_tables_exist()
        
        # Get all active accounts to filter transactions
        active_accounts = get_user_accounts(user_id)
        active_account_ids = {account['account_id'] for account in active_accounts}
        
        table_client = get_table_client("Transactions")
        entities = table_client.list_entities()
        
        # Convert to list and filter by user ID and active accounts
        all_transactions = [dict(entity) for entity in entities if entity.get('PartitionKey') == user_id]
        filtered_transactions = [
            transaction for transaction in all_transactions 
            if transaction.get('account_id') in active_account_ids
        ]
        
        # Apply search filters
        search_results = []
        
        for transaction in filtered_transactions:
            # Description filter (case-insensitive partial match)
            if description and description.lower() not in transaction.get('description', '').lower():
                continue
                
            # Category filter (exact match)
            if category and transaction.get('category', '').lower() != category.lower():
                continue
                
            # Transaction type filter
            if transaction_type and transaction.get('transaction_type', '').lower() != transaction_type.lower():
                continue
                
            # Date range filter
            if start_date or end_date:
                transaction_date = transaction.get('transaction_date', '')
                if start_date and transaction_date < start_date:
                    continue
                if end_date and transaction_date > end_date:
                    continue
            
            search_results.append(transaction)
        
        # Sort by date (newest first)
        search_results.sort(key=lambda x: x.get('transaction_date', ''), reverse=True)
        
        # Apply limit
        search_results = search_results[:limit]
        
        # Get account names for context
        account_names = {account['account_id']: account['account_name'] for account in active_accounts}
        
        # Add account names to results
        for result in search_results:
            result['account_name'] = account_names.get(result.get('account_id', ''), 'Unknown Account')
        
        return {
            "transactions": search_results,
            "total_count": len(search_results),
            "search_criteria": {
                "description": description,
                "category": category,
                "start_date": start_date,
                "end_date": end_date,
                "transaction_type": transaction_type
            }
        }
        
    except Exception as e:
        logging.error(f"Error searching transactions: {str(e)}")
        if handle_first_time_user_error(str(e), user_id, "search_transactions"):
            return {"transactions": [], "total_count": 0, "error": "No transactions found"}
        raise e

def get_balance_history(user_id: str, months: int = 12) -> Dict:
    """Calculate historical balance snapshots for all accounts by reconstructing from transactions"""
    try:
        # Ensure tables exist before trying to query them
        ensure_tables_exist()
        
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
                account_created_date = account.get('created_date', '')
                
                # Check if account existed during this month
                account_existed_this_month = True
                if account_created_date:
                    try:
                        # Parse account creation date
                        creation_date = datetime.fromisoformat(account_created_date.replace('Z', '+00:00'))
                        creation_month = creation_date.strftime('%Y-%m')
                        
                        # If account was created after this month, it didn't exist yet
                        if creation_month > month_key:
                            account_existed_this_month = False
                    except (ValueError, TypeError):
                        # If we can't parse the date, assume account existed
                        pass
                
                # If account didn't exist this month, skip it
                if not account_existed_this_month:
                    continue
                
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
        
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
                    headers = get_cors_headers()
                    headers["Content-Type"] = "application/json"
                    return func.HttpResponse(
                        json.dumps({"error": "Request body is required"}),
                        status_code=400,
                        headers=headers
                    )
                
                # Sanitize input
                account_data = sanitize_user_input(req_body)
                
                # Validate data
                is_valid, errors = validate_account_data(account_data)
                if not is_valid:
                    headers = get_cors_headers()
                    headers["Content-Type"] = "application/json"
                    return func.HttpResponse(
                        json.dumps({"error": "Validation failed", "details": errors}),
                        status_code=400,
                        headers=headers
                    )
                
                # Create account
                new_account = create_bank_account(
                    user_id=user_id,
                    account_name=account_data['account_name'],
                    account_type=account_data['account_type'],
                    initial_balance=float(account_data.get('initial_balance', 0)),
                    bank_name=account_data.get('bank_name', ''),
                    description=account_data.get('description', ''),
                    account_creation_date=account_data.get('account_creation_date')
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
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=headers
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
        if req.method == "POST":
            # Add new transaction
            try:
                req_body = req.get_json()
                if not req_body:
                    headers = get_cors_headers()
                    headers["Content-Type"] = "application/json"
                    return func.HttpResponse(
                        json.dumps({"error": "Request body is required"}),
                        status_code=400,
                        headers=headers
                    )
                
                # Sanitize input
                transaction_data = sanitize_user_input(req_body)
                
                # Validate data
                is_valid, errors = validate_transaction_data(transaction_data)
                if not is_valid:
                    headers = get_cors_headers()
                    headers["Content-Type"] = "application/json"
                    return func.HttpResponse(
                        json.dumps({"error": "Validation failed", "details": errors}),
                        status_code=400,
                        headers=headers
                    )
                
                # Add transaction
                new_transaction = add_transaction(
                    account_id=transaction_data['account_id'],
                    user_id=user_id,
                    amount=float(transaction_data['amount']),
                    description=transaction_data['description'],
                    category=transaction_data['category'],
                    transaction_type=transaction_data['transaction_type'],
                    date=transaction_data.get('transaction_date'),
                    is_recurring=transaction_data.get('is_recurring', False),
                    recurring_frequency=transaction_data.get('recurring_frequency', 'monthly'),
                    recurring_start_date=transaction_data.get('recurring_start_date')
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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

@app.route(route="transactions/search", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def search_transactions_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for searching transactions"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
        # Get search parameters from query string
        description = req.params.get('description', '').strip() or None
        category = req.params.get('category', '').strip() or None
        start_date = req.params.get('start_date', '').strip() or None
        end_date = req.params.get('end_date', '').strip() or None
        transaction_type = req.params.get('transaction_type', '').strip() or None
        limit = int(req.params.get('limit', 100))
        
        # Validate date format if provided
        if start_date:
            try:
                datetime.strptime(start_date, '%Y-%m-%d')
            except ValueError:
                return func.HttpResponse(
                    json.dumps({"error": "Invalid start_date format. Use YYYY-MM-DD"}),
                    status_code=400,
                    headers=get_cors_headers()
                )
        
        if end_date:
            try:
                datetime.strptime(end_date, '%Y-%m-%d')
            except ValueError:
                return func.HttpResponse(
                    json.dumps({"error": "Invalid end_date format. Use YYYY-MM-DD"}),
                    status_code=400,
                    headers=get_cors_headers()
                )
        
        # Validate transaction_type if provided
        if transaction_type and transaction_type.lower() not in ['income', 'expense']:
            return func.HttpResponse(
                json.dumps({"error": "Invalid transaction_type. Must be 'income' or 'expense'"}),
                status_code=400,
                headers=get_cors_headers()
            )
        
        # Perform search
        search_results = search_transactions(
            user_id=user_id,
            description=description,
            category=category,
            start_date=start_date,
            end_date=end_date,
            transaction_type=transaction_type,
            limit=limit
        )
        
        if "error" in search_results:
            return func.HttpResponse(
                json.dumps({"error": search_results["error"]}),
                status_code=500,
                headers=get_cors_headers()
            )
        
        return func.HttpResponse(
            json.dumps(search_results),
            status_code=200,
            headers=get_cors_headers()
        )
        
    except Exception as e:
        logging.error(f"Error in search transactions API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=get_cors_headers()
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
        
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=headers
        )

@app.route(route="accounts/summary/{account_id}", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def account_summary_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting account summary"""
    try:
        
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
        
        # Get account ID from route parameter
        account_id = req.route_params.get('account_id')
        if not account_id:
            return func.HttpResponse(
                json.dumps({"error": "Account ID is required"}),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        
        
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
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
        headers = get_cors_headers()
        headers["Content-Type"] = "application/json"
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=headers
        )

# Scheduled Function for Recurring Transactions
@app.timer_trigger(schedule="0 0 0 * * *", arg_name="timer", run_on_startup=False, use_monitor=False)
def process_daily_recurring_transactions(timer: func.TimerRequest) -> None:
    """Daily scheduled function to create recurring transactions that are due today"""
    try:
        logging.info("Starting daily recurring transaction processing")
        
        # Ensure tables exist
        ensure_tables_exist()
        
        # Get today's date
        today = datetime.utcnow().date()
        today_str = today.strftime('%Y-%m-%d')
        
        logging.info(f"Processing recurring transactions for date: {today_str}")
        
        # Find all recurring transactions that should be created today
        recurring_transactions_to_create = find_recurring_transactions_due_today(today)
        
        if not recurring_transactions_to_create:
            logging.info("No recurring transactions due today")
            return
        
        logging.info(f"Found {len(recurring_transactions_to_create)} recurring transactions due today")
        
        # Create the transactions
        created_count = 0
        failed_count = 0
        
        for recurring_config in recurring_transactions_to_create:
            try:
                success = create_recurring_transaction_for_date(recurring_config, today_str)
                if success:
                    created_count += 1
                    logging.info(f"Created recurring transaction for user {recurring_config['user_id']}, account {recurring_config['account_id']}")
                else:
                    failed_count += 1
                    logging.warning(f"Failed to create recurring transaction for user {recurring_config['user_id']}, account {recurring_config['account_id']}")
            except Exception as e:
                failed_count += 1
                logging.error(f"Error creating recurring transaction for user {recurring_config['user_id']}: {str(e)}")
        
        logging.info(f"Daily recurring transaction processing completed. Created: {created_count}, Failed: {failed_count}")
        
    except Exception as e:
        logging.error(f"Error in daily recurring transaction processing: {str(e)}")
        raise e

def find_recurring_transactions_due_today(today: datetime.date) -> List[Dict]:
    """Find all recurring transactions that should be created today"""
    try:
        table_client = get_table_client("Transactions")
        
        # Get all transactions that are recurring
        entities = table_client.list_entities()
        all_transactions = [dict(entity) for entity in entities]
        
        # Filter for recurring transactions
        recurring_transactions = [
            t for t in all_transactions 
            if t.get('is_recurring') == True and t.get('recurring_start_date')
        ]
        
        due_today = []
        
        for transaction in recurring_transactions:
            try:
                # Parse the start date
                start_date_str = transaction.get('recurring_start_date', '')
                if 'T' in start_date_str:
                    start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00')).date()
                else:
                    start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
                
                # Get the day of month from start date
                start_day = start_date.day
                frequency = transaction.get('recurring_frequency', 'monthly')
                
                # Check if today matches the recurring pattern
                should_create = should_create_recurring_transaction_today(start_date, start_day, frequency, today)
                
                if should_create:
                    # Check if transaction already exists for today
                    already_exists = recurring_transaction_exists_for_date(transaction, today)
                    
                    if not already_exists:
                        due_today.append({
                            'user_id': transaction.get('PartitionKey'),
                            'account_id': transaction.get('account_id'),
                            'amount': float(transaction.get('amount', 0)),
                            'description': transaction.get('description', ''),
                            'category': transaction.get('category', ''),
                            'transaction_type': transaction.get('transaction_type', ''),
                            'recurring_frequency': frequency,
                            'recurring_start_date': start_date_str,
                            'original_transaction_id': transaction.get('RowKey')
                        })
                
            except Exception as e:
                logging.warning(f"Error processing recurring transaction {transaction.get('RowKey', 'unknown')}: {str(e)}")
                continue
        
        return due_today
        
    except Exception as e:
        logging.error(f"Error finding recurring transactions due today: {str(e)}")
        return []

def should_create_recurring_transaction_today(start_date: datetime.date, start_day: int, frequency: str, today: datetime.date) -> bool:
    """Determine if a recurring transaction should be created today"""
    try:
        if frequency == 'monthly':
            # For monthly, check if today is the same day of month as start date
            if today.day == start_day:
                # Check if we're in the same month or a month after the start month
                months_since_start = (today.year - start_date.year) * 12 + (today.month - start_date.month)
                # Allow same month (months_since_start >= 0) for current month recurring transactions
                return months_since_start >= 0
            return False
            
        elif frequency == 'yearly':
            # For yearly, check if today is the same month and day as start date
            if today.month == start_date.month and today.day == start_day:
                # Check if we're in the same year or a year after the start year
                years_since_start = today.year - start_date.year
                return years_since_start >= 0
            return False
            
        else:
            logging.warning(f"Unknown recurring frequency: {frequency}")
            return False
            
    except Exception as e:
        logging.error(f"Error checking if recurring transaction should be created today: {str(e)}")
        return False

def recurring_transaction_exists_for_date(original_transaction: Dict, target_date: datetime.date) -> bool:
    """Check if a recurring transaction already exists for the target date"""
    try:
        table_client = get_table_client("Transactions")
        
        # Get all transactions for the same user and account
        entities = table_client.list_entities()
        all_transactions = [dict(entity) for entity in entities]
        
        user_id = original_transaction.get('PartitionKey')
        account_id = original_transaction.get('account_id')
        target_date_str = target_date.strftime('%Y-%m-%d')
        
        # Check if there's already a transaction for this date with the same details
        # BUT exclude the original recurring transaction (the one we're checking for)
        original_transaction_id = original_transaction.get('RowKey')
        
        for transaction in all_transactions:
            if (transaction.get('PartitionKey') == user_id and
                transaction.get('account_id') == account_id and
                transaction.get('transaction_date', '').startswith(target_date_str) and
                transaction.get('is_recurring') == True and
                transaction.get('RowKey') != original_transaction_id):  # Exclude the original transaction
                return True
        
        return False
        
    except Exception as e:
        logging.error(f"Error checking if recurring transaction exists for date: {str(e)}")
        return False

def create_recurring_transaction_for_date(recurring_config: Dict, target_date_str: str) -> bool:
    """Create a recurring transaction for a specific date"""
    try:
        # Generate unique transaction ID
        transaction_id = str(uuid.uuid4())
        
        # Create transaction entity
        transaction_entity = {
            'PartitionKey': recurring_config['user_id'],
            'RowKey': transaction_id,
            'account_id': recurring_config['account_id'],
            'amount': recurring_config['amount'],
            'description': recurring_config['description'],
            'category': recurring_config['category'],
            'transaction_type': recurring_config['transaction_type'],
            'transaction_date': target_date_str,
            'is_recurring': True,
            'recurring_frequency': recurring_config['recurring_frequency'],
            'recurring_start_date': recurring_config['recurring_start_date'],
            'created_date': datetime.utcnow().isoformat(),
            'last_updated': datetime.utcnow().isoformat()
        }
        
        # Save to table
        table_client = get_table_client("Transactions")
        table_client.create_entity(transaction_entity)
        
        # Update account balance
        update_account_balance(
            recurring_config['account_id'], 
            recurring_config['user_id'], 
            recurring_config['amount'], 
            recurring_config['transaction_type']
        )
        
        logging.info(f"Created recurring transaction {transaction_id} for date {target_date_str}")
        return True
        
    except Exception as e:
        logging.error(f"Error creating recurring transaction for date {target_date_str}: {str(e)}")
        return False

# Test endpoint for recurring transactions
@app.route(route="recurring-test", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def test_recurring_api(req: func.HttpRequest) -> func.HttpResponse:
    """Test endpoint for recurring transactions"""
    try:
        if req.method == "OPTIONS":
            return func.HttpResponse("", status_code=200, headers=get_cors_headers())
        
        return func.HttpResponse(
            json.dumps({"message": "Recurring transactions API is working", "status": "ok"}),
            status_code=200,
            headers=get_cors_headers()
        )
    except Exception as e:
        logging.error(f"Error in test recurring API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=get_cors_headers()
        )

# Get all recurring transactions for a user
@app.route(route="recurring-transactions", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def get_recurring_transactions_api(req: func.HttpRequest) -> func.HttpResponse:
    """API endpoint for getting all recurring transactions grouped by template"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Get user ID using secure authentication
        try:
            user_id = get_user_id_from_request(req)
        except ValueError as auth_error:
            return func.HttpResponse(
                json.dumps({"error": "Authentication required", "details": str(auth_error)}),
                status_code=401,
                headers=get_cors_headers()
            )
        
        # Get recurring transactions
        try:
            recurring_data = get_recurring_transactions_data(user_id)
            
            if "error" in recurring_data:
                return func.HttpResponse(
                    json.dumps({"error": recurring_data["error"]}),
                    status_code=500,
                    headers=get_cors_headers()
                )
            
            return func.HttpResponse(
                json.dumps(recurring_data),
                status_code=200,
                headers=get_cors_headers()
            )
        except Exception as data_error:
            logging.error(f"Error in get_recurring_transactions_data: {str(data_error)}")
            return func.HttpResponse(
                json.dumps({"error": "Failed to get recurring transactions data", "details": str(data_error)}),
                status_code=500,
                headers=get_cors_headers()
            )
        
    except Exception as e:
        logging.error(f"Error in get recurring transactions API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=get_cors_headers()
        )

def get_recurring_transactions_data(user_id: str) -> Dict:
    """Get all recurring transactions grouped by template"""
    try:
        logging.info(f"Getting recurring transactions for user: {user_id}")
        
        # Ensure tables exist
        ensure_tables_exist()
        
        # Get all active accounts to filter transactions
        active_accounts = get_user_accounts(user_id)
        if not active_accounts:
            logging.info("No active accounts found for user")
            return {
                "recurring_transactions": [],
                "total_count": 0
            }
            
        active_account_ids = {account['account_id'] for account in active_accounts}
        account_names = {account['account_id']: account['account_name'] for account in active_accounts}
        
        logging.info(f"Found {len(active_accounts)} active accounts for user")
        
        table_client = get_table_client("Transactions")
        entities = table_client.list_entities()
        
        logging.info("Successfully connected to Transactions table")
        
        # Get all recurring transactions for this user
        all_transactions = [dict(entity) for entity in entities if entity.get('PartitionKey') == user_id]
        logging.info(f"Found {len(all_transactions)} total transactions for user")
        
        recurring_transactions = [
            transaction for transaction in all_transactions 
            if ((transaction.get('is_recurring') == True or transaction.get('is_recurring') == 'True') and 
                transaction.get('account_id') in active_account_ids)
        ]
        
        logging.info(f"Found {len(recurring_transactions)} recurring transactions for user")
        
        if not recurring_transactions:
            logging.info("No recurring transactions found")
            return {
                "recurring_transactions": [],
                "total_count": 0
            }
        
        # Group recurring transactions by template (same description, amount, category, account)
        template_groups = {}
        
        try:
            for transaction in recurring_transactions:
                # Create a unique key for grouping
                template_key = f"{transaction.get('description', '')}_{transaction.get('amount', 0)}_{transaction.get('category', '')}_{transaction.get('account_id', '')}"
                
                if template_key not in template_groups:
                    template_groups[template_key] = {
                        'template_id': template_key,
                        'description': transaction.get('description', ''),
                        'amount': float(transaction.get('amount', 0)),
                        'category': transaction.get('category', ''),
                        'transaction_type': transaction.get('transaction_type', ''),
                        'account_id': transaction.get('account_id', ''),
                        'account_name': account_names.get(transaction.get('account_id', ''), 'Unknown Account'),
                        'frequency': transaction.get('recurring_frequency', 'monthly'),
                        'start_date': transaction.get('recurring_start_date', ''),
                        'occurrence_dates': [],
                        'next_occurrence': None
                    }
                
                # Add this occurrence date
                transaction_date = transaction.get('transaction_date', '')
                if transaction_date:
                    template_groups[template_key]['occurrence_dates'].append(transaction_date)
        except Exception as grouping_error:
            logging.error(f"Error grouping recurring transactions: {str(grouping_error)}")
            # Return a simple list if grouping fails
            return {
                "recurring_transactions": [],
                "total_count": 0,
                "error": "Failed to group recurring transactions"
            }
        
        # Process each template group
        recurring_templates = []
        try:
            for template_key, template_data in template_groups.items():
                # Sort occurrence dates
                template_data['occurrence_dates'].sort()
                
                # Calculate next occurrence
                if template_data['occurrence_dates']:
                    try:
                        last_date = datetime.strptime(template_data['occurrence_dates'][-1], '%Y-%m-%d').date()
                        frequency = template_data['frequency']
                        
                        if frequency == 'monthly':
                            # Add one month to last occurrence
                            if last_date.month == 12:
                                next_date = last_date.replace(year=last_date.year + 1, month=1)
                            else:
                                next_date = last_date.replace(month=last_date.month + 1)
                        elif frequency == 'yearly':
                            # Add one year to last occurrence
                            next_date = last_date.replace(year=last_date.year + 1)
                        else:
                            next_date = None
                        
                        template_data['next_occurrence'] = next_date.strftime('%Y-%m-%d') if next_date else None
                    except Exception as date_error:
                        logging.warning(f"Error calculating next occurrence for template {template_key}: {str(date_error)}")
                        template_data['next_occurrence'] = None
                
                recurring_templates.append(template_data)
            
            # Sort templates by description
            recurring_templates.sort(key=lambda x: x['description'])
            
            logging.info(f"Successfully processed {len(recurring_templates)} recurring transaction templates")
            
            return {
                "recurring_transactions": recurring_templates,
                "total_count": len(recurring_templates)
            }
        except Exception as processing_error:
            logging.error(f"Error processing recurring transaction templates: {str(processing_error)}")
            return {
                "recurring_transactions": [],
                "total_count": 0,
                "error": "Failed to process recurring transaction templates"
            }
        
    except Exception as e:
        logging.error(f"Error getting recurring transactions: {str(e)}")
        if handle_first_time_user_error(str(e), user_id, "get_recurring_transactions"):
            return {"recurring_transactions": [], "total_count": 0, "error": "No recurring transactions found"}
        raise e

# Manual trigger endpoint for testing recurring transactions
@app.route(route="recurring/process", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def manual_recurring_process_api(req: func.HttpRequest) -> func.HttpResponse:
    """Manual API endpoint to trigger recurring transaction processing (for testing)"""
    try:
        # Handle CORS preflight requests
        if req.method == "OPTIONS":
            return func.HttpResponse(
                "",
                status_code=200,
                headers=get_cors_headers()
            )
        
        # Check if this is production environment
        environment = os.environ.get("ENVIRONMENT", "development")
        if environment.lower() == "production":
            return func.HttpResponse(
                json.dumps({"error": "This endpoint is not available in production"}),
                status_code=403,
                headers=get_cors_headers()
            )
        
        if req.method == "POST":
            # Get today's date
            today = datetime.utcnow().date()
            today_str = today.strftime('%Y-%m-%d')
            
            logging.info(f"Manual recurring transaction processing triggered for date: {today_str}")
            
            # Find all recurring transactions that should be created today
            recurring_transactions_to_create = find_recurring_transactions_due_today(today)
            
            if not recurring_transactions_to_create:
                return func.HttpResponse(
                    json.dumps({
                        "message": "No recurring transactions due today",
                        "date": today_str,
                        "found": 0,
                        "created": 0,
                        "failed": 0
                    }),
                    status_code=200,
                    headers=get_cors_headers()
                )
            
            # Create the transactions
            created_count = 0
            failed_count = 0
            
            for recurring_config in recurring_transactions_to_create:
                try:
                    success = create_recurring_transaction_for_date(recurring_config, today_str)
                    if success:
                        created_count += 1
                    else:
                        failed_count += 1
                except Exception as e:
                    failed_count += 1
                    logging.error(f"Error creating recurring transaction: {str(e)}")
            
            result = {
                "message": "Recurring transaction processing completed",
                "date": today_str,
                "found": len(recurring_transactions_to_create),
                "created": created_count,
                "failed": failed_count
            }
            
            return func.HttpResponse(
                json.dumps(result),
                status_code=200,
                headers=get_cors_headers()
            )
        
        return func.HttpResponse(
            json.dumps({"error": "Method not allowed"}),
            status_code=405,
            headers=get_cors_headers()
        )
    
    except Exception as e:
        logging.error(f"Error in manual recurring process API: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": "Internal server error", "details": str(e)}),
            status_code=500,
            headers=get_cors_headers()
        )