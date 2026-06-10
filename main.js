document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const loadingState = document.getElementById('loading-state');
  const successMessage = document.getElementById('success-message');
  const errorMessage = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');

  // Drag and drop events
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.remove('dragover');
    }, false);
  });

  // Handle file drop
  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length) {
      handleFile(files[0]);
    }
  });

  // Handle file input click
  fileInput.addEventListener('change', function() {
    if (this.files.length) {
      handleFile(this.files[0]);
    }
  });

  function handleFile(file) {
    // Hide previous messages
    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');

    if (!file.name.toLowerCase().endsWith('.acsm')) {
      showError('Invalid data format. Please upload a valid configuration package.');
      return;
    }

    uploadAndConvert(file);
  }

  async function uploadAndConvert(file) {
    const formData = new FormData();
    formData.append('file', file);

    // Show loading state
    loadingState.classList.remove('hidden');

    try {
      const response = await fetch('/api/index', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: 'Unknown server error.' };
        }
        throw new Error(errorData.error || 'Conversion failed');
      }

      // Handle the file download
      const blob = await response.blob();
      
      // Get filename from Content-Disposition header if possible, else default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = file.name.replace('.acsm', '.epub');
      if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].replace(/["']/g, '');
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);

      showSuccess();

    } catch (error) {
      console.error('Error:', error);
      showError(error.message);
    } finally {
      loadingState.classList.add('hidden');
      fileInput.value = ''; // Reset input
    }
  }

  function showSuccess() {
    successMessage.classList.remove('hidden');
    setTimeout(() => {
      successMessage.classList.add('hidden');
    }, 5000);
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorMessage.classList.remove('hidden');
  }
});
