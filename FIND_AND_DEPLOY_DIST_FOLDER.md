# 🗂️ Find and Deploy the `/dist/` Folder

## 📍 **Where is the `/dist/` Folder?**

The `/dist/` folder is located in your project directory at:
```
sdk-addin-samples/addin-heatmap/dist/
```

### **Complete Folder Structure:**
```
sdk-addin-samples/
├── addin-heatmap/
│   ├── app/                 # Original development files
│   └── dist/                # ✅ Enhanced production files (THIS IS WHAT YOU NEED)
│       ├── heatmap.html     # Main HTML file with EV data checkbox
│       ├── styles/
│       │   ├── main.css     # Modern CSS styling
│       │   └── spinner.css  # Loading animations
│       ├── scripts/
│       │   └── main.js      # Enhanced JavaScript with EV support
│       └── images/
│           └── icon.svg     # Add-in icon
└── ... (other files)
```

---

## 🔍 **How to Find It on Your PC**

### **Method 1: File Explorer (Windows)**
1. Open File Explorer
2. Navigate to your project folder (likely named `sdk-addin-samples`)
3. Go to: `addin-heatmap` → `dist`
4. You should see all the enhanced files

### **Method 2: Finder (Mac)**
1. Open Finder
2. Navigate to your project folder (likely named `sdk-addin-samples`)
3. Go to: `addin-heatmap` → `dist`
4. You should see all the enhanced files

### **Method 3: Terminal/Command Line**
```bash
# Navigate to your project folder
cd /path/to/sdk-addin-samples

# List files in the dist folder
ls addin-heatmap/dist/

# You should see:
# heatmap.html
# images/
# scripts/
# styles/
```

---

## 🚀 **Deploy the `/dist/` Folder to GitHub**

### **Option 1: If You Already Have a Local Repository**

1. **Open Terminal/Git Bash** and navigate to your repository:
   ```bash
   cd /path/to/sdk-addin-samples
   ```

2. **Check if the dist folder exists**:
   ```bash
   ls addin-heatmap/dist/
   ```

3. **Add the dist folder to git**:
   ```bash
   git add addin-heatmap/dist
   ```

4. **Commit the changes**:
   ```bash
   git commit -m "Add enhanced Heat Map files to dist folder with EV data support"
   ```

5. **Push to GitHub**:
   ```bash
   git push origin main
   ```
   *(If your branch is named "master", use `git push origin master`)*

### **Option 2: If You Don't Have the Files Locally**

If the files don't exist on your local computer, you'll need to download them first:

1. **Download the enhanced files** from this environment
2. **Place them in your local repository** in the `addin-heatmap/dist/` folder
3. **Then follow the git steps above**

---

## 📥 **How to Download the Enhanced Files**

Since you're working in this environment, here's how to get the files:

### **Method 1: Download Each File Individually**

1. **HTML File**: `addin-heatmap/dist/heatmap.html`
2. **CSS Files**: 
   - `addin-heatmap/dist/styles/main.css`
   - `addin-heatmap/dist/styles/spinner.css`
3. **JavaScript File**: `addin-heatmap/dist/scripts/main.js`
4. **Icon File**: `addin-heatmap/dist/images/icon.svg`

### **Method 2: Copy File Contents**

You can copy the contents of each file and paste them into your local files:

1. **Open each file** in this environment
2. **Copy the entire content**
3. **Create the same file structure** in your local repository
4. **Paste the content** into each corresponding file

---

## 📂 **File Contents Reference**

### **1. HTML File** (`addin-heatmap/dist/heatmap.html`)
Contains the EV data checkbox:
```html
<label for="includeEVData">Include Electric Vehicle Data:</label>
<input type="checkbox" id="includeEVData" />
<small style="color: #666; font-size: 0.9em; display: block; margin-top: 0.2em;">
  Shows battery levels, charging events, and battery health data
</small>
```

### **2. JavaScript File** (`addin-heatmap/dist/scripts/main.js`)
Contains enhanced features:
- `processEVData()` function for battery visualization
- `displayCombinedHeatMap()` for combined location + EV data
- Enhanced error handling and validation
- Vehicle and rule loading from Geotab API

### **3. CSS Files** (`addin-heatmap/dist/styles/`)
- Modern styling with Inter font
- Responsive design for all devices
- Enhanced form controls and buttons
- Professional color scheme

---

## ⏱️ **Deployment Timeline**

1. **Find/Create files locally**: 5-10 minutes
2. **Add to git and commit**: 2 minutes
3. **Push to GitHub**: 1 minute
4. **GitHub Pages deployment**: 1-2 minutes
5. **Install in MyGeotab**: 2 minutes

**Total time**: 10-15 minutes

---

## ✅ **Verify Deployment**

After deployment, check these URLs:
1. https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/heatmap.html
2. https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/images/icon.svg
3. https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/styles/main.css
4. https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/scripts/main.js

All URLs should return a 200 OK status (no 404 errors).

---

## 🎉 **Ready to Install**

Once deployed, install in MyGeotab with this configuration:
```json
{
  "name": "Heat Map - Enhanced",
  "supportEmail": "support@geotab.com",
  "version": "2.0.0",
  "items": [{
    "url": "https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/heatmap.html",
    "path": "ActivityLink/",
    "menuName": {
      "en": "Heat Map"
    },
    "icon": "https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/images/icon.svg"
  }],
  "isSigned": false
}
```

---

## 📞 **Need More Help?**

If you're still having trouble locating or deploying the files:

1. **Share your file structure** and I can provide more specific guidance
2. **Let me know your Git experience level** (beginner/intermediate/advanced)
3. **Tell me if you're using GitHub Desktop, Terminal, or Web Interface**

I'm here to help you get the enhanced Heat Map add-in deployed successfully!
