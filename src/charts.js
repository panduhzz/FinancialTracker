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
function renderFinancialOverviewChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) {
    console.error(`Canvas element with id '${canvasId}' not found`);
    return;
  }
  
  // Destroy existing chart if it exists
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }
  
  const months = Object.keys(data.monthly_data);
  const monthLabels = generateMonthLabels(months.length);
  
  // Prepare data arrays
  const incomeData = months.map(month => data.monthly_data[month].income || 0);
  const expenseData = months.map(month => data.monthly_data[month].expense || 0);
  const netData = months.map(month => data.monthly_data[month].net || 0);
  const balanceData = months.map(month => data.monthly_data[month].total_balance || 0);
  
  // Get Y-axis scales from backend
  const yAxisScale = data.chart_config?.y_axis_scale || calculateYAxisScale([...incomeData, ...expenseData, ...netData]);
  const balanceYAxisScale = data.chart_config?.balance_y_axis_scale || calculateYAxisScale(balanceData);
  
  const chartConfig = {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: 'Income',
          data: incomeData,
          borderColor: '#28a745',
          backgroundColor: 'rgba(40, 167, 69, 0.1)',
          tension: 0.4,
          fill: false,
          yAxisID: 'y'
        },
        {
          label: 'Expenses',
          data: expenseData,
          borderColor: '#dc3545',
          backgroundColor: 'rgba(220, 53, 69, 0.1)',
          tension: 0.4,
          fill: false,
          yAxisID: 'y'
        },
        {
          label: 'Net (Income - Expenses)',
          data: netData,
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          tension: 0.4,
          fill: false,
          yAxisID: 'y'
        },
        {
          label: 'Total Account Balance',
          data: balanceData,
          borderColor: '#ffc107',
          backgroundColor: 'rgba(255, 193, 7, 0.1)',
          tension: 0.4,
          fill: false,
          yAxisID: 'y1',
          borderWidth: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
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
            text: 'Income/Expenses ($)'
          },
          min: yAxisScale.min,
          max: yAxisScale.max,
          ticks: {
            stepSize: yAxisScale.interval,
            callback: function(value) {
              return formatCurrency(value);
            }
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Account Balance ($)'
          },
          min: balanceYAxisScale.min,
          max: balanceYAxisScale.max,
          ticks: {
            stepSize: balanceYAxisScale.interval,
            callback: function(value) {
              return formatCurrency(value);
            }
          },
          grid: {
            drawOnChartArea: false,
          },
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
async function loadFinancialOverviewChart() {
  try {
    const userId = localStorage.getItem('userId') || 'dev-user-123';
    const response = await fetch(`${API_CONFIG.getBaseUrl()}/analytics/monthly-summary?months=12`, {
      method: 'GET',
      headers: {
        'X-User-ID': userId,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      console.error('Error loading financial overview data:', data.error);
      showMessage('Error loading chart data: ' + data.error, 'error');
      return;
    }
    
    // Render the chart
    renderFinancialOverviewChart('overviewChart', data);
    
  } catch (error) {
    console.error('Error loading financial overview chart:', error);
    showMessage('Error loading chart data', 'error');
  }
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

// Show message function (if not already defined)
function showMessage(message, type = 'info') {
  // Create a simple message display
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = message;
  messageDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 5px;
    color: white;
    font-weight: bold;
    z-index: 1000;
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  if (type === 'success') {
    messageDiv.style.backgroundColor = '#28a745';
  } else if (type === 'error') {
    messageDiv.style.backgroundColor = '#dc3545';
  } else {
    messageDiv.style.backgroundColor = '#6c757d';
  }
  
  document.body.appendChild(messageDiv);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.parentNode.removeChild(messageDiv);
    }
  }, 5000);
}
