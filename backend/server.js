const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3001;

app.use(cors());

// Configure multer for file uploads
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

// Ensure directories exist
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

app.post('/api/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const inputFile = req.file.path;
  console.log(`Received file: ${inputFile}`);

  // Determine python script and venv python paths
  const pythonCoreDir = path.join(__dirname, '..', 'python-core');
  const pythonExe = path.join(pythonCoreDir, 'venv', 'bin', 'python3');
  const mainScript = path.join(pythonCoreDir, 'main.py');

  // We need to run the python script with cwd = pythonCoreDir so it finds libadobe files
  const command = `"${pythonExe}" "${mainScript}" "${inputFile}" "${outputDir}"`;

  console.log(`Running command: ${command}`);

  exec(command, { cwd: pythonCoreDir }, (error, stdout, stderr) => {
    console.log(`stdout: ${stdout}`);
    if (error) {
      console.error(`exec error: ${error}`);
      console.error(`stderr: ${stderr}`);
      return res.status(500).json({ error: 'Conversion failed', details: stdout || stderr });
    }

    // The script puts the .epub file in outputDir. 
    // We need to find the .epub file. The script might rename it based on the book title.
    fs.readdir(outputDir, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Could not read output directory' });
      }

      // Find the first .epub file (assuming only one is generated per request, 
      // but in a concurrent environment we should really match by some ID. 
      // For a local single-user tool, taking the newest .epub is fine).
      const epubFiles = files.filter(f => f.endsWith('.epub'));
      if (epubFiles.length === 0) {
        return res.status(500).json({ error: 'No EPUB file was generated.', details: stdout });
      }

      // Sort by creation time to get the latest
      const latestEpub = epubFiles.map(file => {
        return {
          name: file,
          time: fs.statSync(path.join(outputDir, file)).mtime.getTime()
        };
      }).sort((a, b) => b.time - a.time)[0].name;

      const epubPath = path.join(outputDir, latestEpub);

      // Send the file
      res.download(epubPath, latestEpub, (downloadErr) => {
        if (downloadErr) {
          console.error('Error downloading file:', downloadErr);
        }
        
        // Clean up: delete the input ACSM and the output EPUB
        fs.unlink(inputFile, () => {});
        fs.unlink(epubPath, () => {});
      });
    });
  });
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
