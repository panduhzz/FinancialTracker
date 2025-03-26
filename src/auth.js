// Include the MSAL.js configuration and initialization
const msalConfig = {
    auth: {
      clientId: 'e8c1227e-f95c-4a0a-bf39-f3ce4c78c781', // Replace with your actual client ID
      authority: 'https://PanduhzProject.b2clogin.com/PanduhzProject.onmicrosoft.com/B2C_1_testonsiteflow', // Replace with your tenant name and policy
      knownAuthorities: ['PanduhzProject.b2clogin.com'],
      redirectUri: 'https://black-sand-0fa8bd51e.6.azurestaticapps.net/', // Replace with your redirect URI (e.g., 'http://localhost:3000' for local testing)
    },
  };
  
  // Initialize MSAL instance
  const msalInstance = new msal.PublicClientApplication(msalConfig);
  
  // Implement login function
  function signIn() {
    const loginRequest = {
      scopes: ['openid', 'profile', 'offline_access'],
    };
  
    msalInstance.loginPopup(loginRequest)
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
        updateUIAfterLogin(familyName, givenName);
      })
      .catch(error => {
        // Handle login error
        console.error('Login failed:', error);
      });
  }
  
  // Implement logout function
  function signOut() {
    msalInstance.logout();
    //clear out local storage so name is not stored any longer
    localStorage.clear();
  }
  
  // Function to initialize the UI on page load
  function initializeUI() {
    const familyName = localStorage.getItem('familyName');
    const givenName = localStorage.getItem('givenName');
    if (familyName && givenName) {
      updateUIAfterLogin(familyName, givenName);
    } else {
      welcomeMessage.textContent = 'Please sign in to continue.';
    }
  }
  
  // Call initializeUI when the page loads
  /*window.onload = function() {
    if (currentAccounts) {
      initializeUI();
    } else {
      updateUIAfterLogOut();
    }
  }
  */

  // Function to update the UI after login
  function updateUIAfterLogin(familyName, givenName) {
    window.location.replace("/loggedIn.html")
    console.log('In updateUIAfterLogin')
    const accountSession = msalInstance.getAccount();
    console.log(accountSession)
    //console.log(accountSession);
    const welcomeMessage = document.getElementById('signedInMessage');
    welcomeMessage.textContent = `Welcome, ${givenName} ${familyName}!`;
    // Show authenticated content, hide sign-in button, etc.
  }
  
  // Check if user is already logged in
  const currentAccounts = msalInstance.getAllAccounts();
  if (currentAccounts && currentAccounts.length > 0) {
    console.log('User is already logged in.');
    updateUIAfterLogin(currentAccounts[0]);
  }
  