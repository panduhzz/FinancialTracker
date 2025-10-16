// Chart functionality for Financial Tracker
// This file contains all chart-related functions for displaying financial data

// Global chart instances storage
const chartInstances = {};

// Use global API_CONFIG from other files
// API_CONFIG should be declared in financialTracking.js or accounts.js

// Chart utility functions
function generateMonthLabels(months = 12) {
  const labels = [];
  const currentDate = new Date();
  
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const monthName = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear();
    labels.push(`${monthName} ${year}`);
  }
  
  return labels;
}

function calculateYAxisScale(data) {
  const values = data.flat();
  if (values.length === 0) {
    return { min: 0, max: 1000, interval: 100 };
  }
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  
  // Determine appropriate interval
  let interval;
  if (range <= 500) {
    interval = 50;
  } else if (range <= 1000) {
    interval = 100;
  } else if (range <= 5000) {
    interval = 500;
  } else {
    interval = 1000;
  }
  
  // Calculate min and max for axis
  const axisMin = Math.max(0, Math.floor(min / interval) * interval - interval);
  const axisMax = Math.ceil(max / interval) * interval + interval;
  
  return {
    min: axisMin,
    max: axisMax,
    interval: interval
  };
}

function formatCurrency(value) {
  return '$' + value.toLocaleString();
}

// Chart rendering functions
function renderAccountBalanceChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) {
    return;
  }
  
  // Destroy existing chart if it exists
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }
  
  // Generate month labels from the data
  const monthLabels = data.months.map(month => {
    const [year, monthNum] = month.split('-');
    const date = new Date(year, monthNum - 1, 1);
    const monthName = date.toLocaleDateString('en-US', { month: 'short' });
    return `${monthName} ${year}`;
  });
  
  // Get Y-axis scale from backend or calculate it
  const yAxisScale = data.chart_config?.y_axis_scale || calculateYAxisScale(data.balances);
  
  const chartConfig = {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: 'Account Balance',
          data: data.balances,
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          tension: 0,  // No curve - straight lines between points
          fill: true,
          borderWidth: 3,
          pointBackgroundColor: '#667eea',
          pointBorderColor: '#667eea',
          pointRadius: 4,
          pointHoverRadius: 6,
          stepped: false  // Ensure it's not stepped
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          display: true
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return 'Account Balance: ' + formatCurrency(context.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Month'
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Account Balance ($)'
          },
          min: yAxisScale.min,
          max: yAxisScale.max,
          ticks: {
            stepSize: yAxisScale.interval,
            callback: function(value) {
              return formatCurrency(value);
            }
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  };
  
  chartInstances[canvasId] = new Chart(ctx, chartConfig);
}


// API functions for loading chart data
async function loadAccountBalanceChart() {
  try {
    const response = await makeAuthenticatedRequest(`${API_CONFIG.getBaseUrl()}/analytics/account-balance?months=12`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      showMessage('Error loading chart data: ' + data.error, 'error');
      return;
    }
    
    // Render the chart
    renderAccountBalanceChart('financialOverviewChart', data);
    
  } catch (error) {
    console.error('Error loading account balance chart:', error);
    showMessage('Error loading chart data', 'error');
  }
}

// Keep the old function name for backward compatibility
async function loadFinancialOverviewChart() {
  return loadAccountBalanceChart();
}


// Utility functions
function destroyChart(canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }
}

function destroyAllCharts() {
  Object.keys(chartInstances).forEach(canvasId => {
    destroyChart(canvasId);
  });
}

// Use centralized showMessage from utils.js
