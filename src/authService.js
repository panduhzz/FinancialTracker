// Centralized Authentication Service
// Singleton class to manage MSAL authentication, token acquisition, and caching

class AuthService {
  static instance = null;
  
  constructor() {
    this.msalInstance = null;
    this.config = {
      auth: {
        clientId: 'e8c1227e-f95c-4a0a-bf39-f3ce4c78c781',
        authority: 'https://PanduhzProject.b2clogin.com/PanduhzProject.onmicrosoft.com/B2C_1_testonsiteflow',
        knownAuthorities: ['PanduhzProject.b2clogin.com'],
        redirectUri: window.location.origin,
      },
      api: {
        scopes: ['e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user']
      }
    };
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new AuthService();
    }
    return this.instance;
  }

  async initialize() {
    if (!this.msalInstance) {
      this.msalInstance = new msal.PublicClientApplication(this.config);
      this.msalInstance.enableAccountStorageEvents();
      
      // Make globally accessible for backward compatibility
      window.msalInstance = this.msalInstance;
      
      // Add event callbacks
      this.msalInstance.addEventCallback((message) => {
        if (message.eventType === msal.EventType.LOGIN_SUCCESS) {
          console.log('Login successful');
        }
      });
    }
    return this.msalInstance;
  }

  async signIn() {
    const msalInstance = await this.initialize();
    
    const loginRequest = {
      scopes: ['openid', 'profile', 'offline_access', 'https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user'],
    };

    try {
      const response = await msalInstance.loginPopup(loginRequest);
      return response;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  async signOut() {
    const msalInstance = await this.initialize();
    try {
      await msalInstance.logoutPopup();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }

  async getCurrentUser() {
    const msalInstance = await this.initialize();
    const accounts = msalInstance.getAllAccounts();
    
    if (accounts && accounts.length > 0) {
      const account = accounts[0];
      return {
        id: account.idTokenClaims.oid,
        name: `${account.idTokenClaims.given_name} ${account.idTokenClaims.family_name}`,
        email: account.idTokenClaims.emails[0]
      };
    }
    return null;
  }

  async getToken() {
    const msalInstance = await this.initialize();
    const account = msalInstance.getAllAccounts()[0];
    
    if (!account) {
      throw new Error('No authenticated user found');
    }

    try {
      const tokenResponse = await msalInstance.acquireTokenSilent({
        scopes: ['https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user'],
        account: account
      });
      return tokenResponse.accessToken;
    } catch (error) {
      // Try interactive if silent fails
      try {
        const tokenResponse = await msalInstance.acquireTokenPopup({
          scopes: ['https://PanduhzProject.onmicrosoft.com/api://e8c1227e-f95c-4a0a-bf39-f3ce4c78c781/access_as_user']
        });
        return tokenResponse.accessToken;
      } catch (popupError) {
        console.error('Error acquiring token via popup:', popupError);
        throw popupError;
      }
    }
  }

  // Centralized authenticated request with caching
  async makeAuthenticatedRequest(url, options = {}) {
    const method = options.method || 'GET';
    const cacheKey = `${method}_${url}`;
    
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
      }
    }
    
    try {
      const token = await this.getToken();
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
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
      }
      
      return response;
    } catch (error) {
      console.error('Error making authenticated request:', error);
      throw error;
    }
  }
}

// Make globally accessible
window.AuthService = AuthService;
