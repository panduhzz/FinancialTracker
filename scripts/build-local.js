const fs = require('fs');
const path = require('path');

// Load environment variables from .env.development
require('dotenv').config({ path: '.env.development' });

// Fallback values for local development
const defaultEnv = {
  REACT_APP_API_URL: 'http://localhost:7071/api',
  REACT_APP_ENVIRONMENT: 'development',
  REACT_APP_DEBUG: 'true'
};

function injectEnvironmentVariables() {
  const htmlFiles = [
    'src/index.html',
    'src/loggedIn.html',
    'src/financialTracking.html'
  ];

  htmlFiles.forEach(file => {
    if (fs.existsSync(file)) {
      let content = fs.readFileSync(file, 'utf8');
      
      // Remove existing environment injection
      content = content.replace(/<script>\s*window\.REACT_APP_[^<]*<\/script>\s*/g, '');
      
      // Inject environment variables with fallbacks
      const envScript = `<script>
  window.REACT_APP_API_URL = '${process.env.REACT_APP_API_URL || defaultEnv.REACT_APP_API_URL}';
  window.REACT_APP_ENVIRONMENT = '${process.env.REACT_APP_ENVIRONMENT || defaultEnv.REACT_APP_ENVIRONMENT}';
  window.REACT_APP_DEBUG = ${process.env.REACT_APP_DEBUG || defaultEnv.REACT_APP_DEBUG};
</script>`;
      
      if (content.includes('</head>')) {
        content = content.replace('</head>', `  ${envScript}\n</head>`);
      } else {
        content = envScript + '\n' + content;
      }
      
      fs.writeFileSync(file, content);
      console.log(`✅ Injected environment variables into ${file}`);
    }
  });
}

injectEnvironmentVariables();
console.log('🚀 Local build complete! Environment variables injected.');
