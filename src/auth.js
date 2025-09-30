
// Global utility functions
window.isProduction = function() {
  return window.location.hostname !== 'localhost' && 
         !window.location.hostname.includes('127.0.0.1') &&
         !window.location.hostname.includes('azurewebsites.net');
};

window.getNavigationUrl = function(productionPath, localPath) {
  return window.isProduction() ? productionPath : localPath;
};

// Wait for MSAL library to load
window.addEventListener('load', function() {
  // Include the MSAL.js configuration and initialization
  const msalConfig = {
    auth: {
      clientId: 'e8c1227e-f95c-4a0a-bf39-f3ce4c78c781', // Replace with your actual client ID
      authority: 'https://PanduhzProject.b2clogin.com/PanduhzProject.onmicrosoft.com/B2C_1_testonsiteflow', // Replace with your tenant name and policy
      knownAuthorities: ['PanduhzProject.b2clogin.com'],
      redirectUri: window.location.origin,
    },
    // Add API scope for secure backend communication
    api: {
      scopes: ['e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user']
    }
  };
  
  // Initialize MSAL instance
  const msalInstance = new msal.PublicClientApplication(msalConfig);

  //enabling events to be utilized in code
  msalInstance.enableAccountStorageEvents();
  
  // Make msalInstance globally accessible
  window.msalInstance = msalInstance;

  // Add event callback AFTER msalInstance is created
  window.msalInstance.addEventCallback((message) => {
    if (message.eventType === msal.EventType.LOGIN_SUCCESS) {
    }
    //can add else if statements for different EventTypes. Don't see a need at the moment for other ones.
  });
});

// Implement login function
function signIn() {
  // Check if msalInstance is available
  if (!window.msalInstance) {
    console.error('MSAL instance not initialized yet. Please wait for page to load.');
    return;
  }

  const loginRequest = {
    scopes: ['openid', 'profile', 'offline_access', 'https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user'],
  };

  window.msalInstance.loginPopup(loginRequest)
    .then(response => {
      // Handle successful login
      // You can store user information or tokens here
      const account = response.account;
      const familyName = account.idTokenClaims.family_name;
      const givenName = account.idTokenClaims.given_name;
      
      // Redirect immediately to login page using environment-based navigation
      window.location.replace(window.getNavigationUrl('/login', '/loggedIn.html'));
    })
    .catch(error => {
      // Handle login error
      console.error('Login failed:', error);
    });
};
  
// Secure API request function with caching
async function makeAuthenticatedRequest(url, options = {}) {
  const method = options.method || 'GET';
  const cacheKey = `${method}_${url}`;
  
  // Debug logging (only for GET requests)
  if (method === 'GET' && window.cacheDebug) {
  }
  
  // Check cache for GET requests only
  if (method === 'GET' && window.dataCache) {
    const cached = window.dataCache.get(cacheKey);
    if (cached) {
      // Return a response-like object that mimics fetch response
      return {
        ok: cached.ok,
        status: cached.status,
        statusText: cached.statusText,
        json: async () => cached.data,
        text: async () => JSON.stringify(cached.data),
        headers: new Headers(cached.headers || {})
      };
    } else {
    }
  } else {
  }
  
  try {
    const account = window.msalInstance.getAllAccounts()[0];
    if (!account) {
      throw new Error('User not authenticated');
    }
    
    // Use API scope (the working configuration)
    let tokenResponse;
    try {
      tokenResponse = await window.msalInstance.acquireTokenSilent({
        scopes: ['https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user'],
        account: account
      });
    } catch (error) {
      console.error('Failed to acquire token with API scope:', error);
      throw error;
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenResponse.accessToken}`,
      ...options.headers
    };
    
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    // Cache successful GET responses
    if (method === 'GET' && response.ok && window.dataCache) {
      try {
        const data = await response.clone().json();
        window.dataCache.set(cacheKey, {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          data: data,
          headers: Object.fromEntries(response.headers.entries())
        });
      } catch (jsonError) {
        console.warn('Failed to cache response (not JSON):', jsonError);
      }
    } else {
    }
    
    return response;
  } catch (error) {
    console.error('Error making authenticated request:', error);
    
    // If silent token acquisition fails, try interactive
    if (error.errorCode === 'consent_required' || error.errorCode === 'interaction_required') {
      try {
        const tokenResponse = await window.msalInstance.acquireTokenPopup({
          scopes: ['https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user']
        });
        
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenResponse.accessToken}`,
          ...options.headers
        };
        
        const response = await fetch(url, {
          ...options,
          headers
        });
        
        // Cache successful GET responses
        if (method === 'GET' && response.ok && window.dataCache) {
          try {
            const data = await response.clone().json();
            if (window.cacheDebug) {
            }
            window.dataCache.set(cacheKey, {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              data: data,
              headers: Object.fromEntries(response.headers.entries())
            });
            if (window.cacheDebug) {
            }
          } catch (jsonError) {
            console.warn('Failed to cache response (not JSON):', jsonError);
          }
        } else if (window.cacheDebug) {
        }
        
        return response;
      } catch (popupError) {
        console.error('Error acquiring token via popup:', popupError);
        throw popupError;
      }
    }
    
    throw error;
  }
}

// Check if user is already logged in
  /*
  const currentAccounts = msalInstance.getAllAccounts();
  if (currentAccounts && currentAccounts.length > 0) {
    updateUIAfterLogin(currentAccounts[0]);
  } */
  
// Function to determine redirect URI based on environment
