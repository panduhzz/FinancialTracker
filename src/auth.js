
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
      console.log("Account added:", message.payload);
      const familyName = localStorage.getItem('familyName');
      const givenName = localStorage.getItem('givenName');
      updateUIAfterLogin(familyName, givenName);
      console.log("payload:" + message.payload);
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
    scopes: ['openid', 'profile', 'offline_access'],
  };

  window.msalInstance.loginPopup(loginRequest)
    .then(response => {
      // Handle successful login
      console.log('Login successful!', response);
      // You can store user information or tokens here
      const account = response.account;
      console.log(account);
      const familyName = account.idTokenClaims.family_name;
      console.log(familyName);
      const givenName = account.idTokenClaims.given_name;
      console.log(givenName);
      // Store user information in local storage
      localStorage.setItem('familyName', familyName);
      localStorage.setItem('givenName', givenName);
    })
    .catch(error => {
      // Handle login error
      console.error('Login failed:', error);
    });
};

// Function to update the UI after login
function updateUIAfterLogin(familyName, givenName) {
  window.location.replace("/loggedIn.html") //need to change the location of this, once this runs everything else after does not run.
  console.log('In updateUIAfterLogin')
  checkToken()
  //console.log(accountSession);
  const welcomeMessage = document.getElementById('signedInMessage');
  if (welcomeMessage) {
    welcomeMessage.textContent = `Welcome, ${givenName} ${familyName}!`;
  }
  // Show authenticated content, hide sign-in button, etc.
}

function checkToken(){
  console.log("Checking token")
  if (window.msalInstance) {
    const accountSession = window.msalInstance.getAllAccounts();
    console.log(accountSession)
    const token = window.msalInstance.acquireTokenSilent()
    console.log(token)
  }
}
  
// Check if user is already logged in
  /*
  const currentAccounts = msalInstance.getAllAccounts();
  if (currentAccounts && currentAccounts.length > 0) {
    console.log('User is already logged in.');
    updateUIAfterLogin(currentAccounts[0]);
  } */
  
// Function to determine redirect URI based on environment
