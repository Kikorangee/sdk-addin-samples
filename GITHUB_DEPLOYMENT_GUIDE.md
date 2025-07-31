# 🚀 GitHub Deployment Guide - Commit and Push `/dist/` Folder

## 📋 **Prerequisites**
Make sure you have:
- Git installed on your computer
- Access to your GitHub repository (`kikorangee/sdk-addin-samples`)
- Your GitHub credentials ready

---

## 🛠️ **Method 1: Using Command Line (Recommended)**

### **Step 1: Navigate to Your Repository**
Open Terminal/Command Prompt and navigate to your local repository folder:
```bash
cd /path/to/your/sdk-addin-samples
```

### **Step 2: Check Current Status**
```bash
git status
```

### **Step 3: Add the `/dist/` Folder**
```bash
git add addin-heatmap/dist
```

### **Step 4: Commit the Changes**
```bash
git commit -m "Add enhanced Heat Map files to dist folder with EV data support"
```

### **Step 5: Push to GitHub**
```bash
git push origin main
```
*(If your default branch is named "master" instead of "main", use `git push origin master`)*

---

## 🖥️ **Method 2: Using GitHub Desktop**

### **Step 1: Open GitHub Desktop**
1. Open GitHub Desktop application
2. Select your `sdk-addin-samples` repository

### **Step 2: Add Files**
1. In the left panel, you should see the new `/dist/` folder files marked as "Added"
2. If you don't see them, make sure you've saved all files in the `/dist/` folder

### **Step 3: Commit Changes**
1. In the bottom left, add a summary:
   ```
   Add enhanced Heat Map files to dist folder with EV data support
   ```
2. Click **"Commit to main"** (or "master")

### **Step 4: Push to GitHub**
1. Click **"Push origin"** button in the top toolbar

---

## 🌐 **Method 3: Using GitHub Web Interface (If Files Are Not Local)**

If you don't have the files locally and need to upload them directly:

### **Step 1: Go to Your Repository**
1. Open browser and go to: https://github.com/kikorangee/sdk-addin-samples
2. Sign in to your GitHub account

### **Step 2: Navigate to the Correct Folder**
1. Click on `addin-heatmap` folder
2. You should see the current files

### **Step 3: Upload Files**
1. Click **"Add file"** → **"Upload files"**
2. Drag and drop all files from your `/dist/` folder:
   - `heatmap.html`
   - `styles/main.css`
   - `styles/spinner.css`
   - `scripts/main.js`
   - `images/icon.svg`
3. Add commit message:
   ```
   Add enhanced Heat Map files to dist folder with EV data support
   ```
4. Click **"Commit changes"**

---

## ⏱️ **Wait for GitHub Pages Deployment**

After pushing the files:

1. **Wait 1-2 minutes** for GitHub Pages to process the changes
2. **Check deployment status**:
   - Go to your repository Settings
   - Scroll down to "Pages" section
   - Check the deployment status

---

## ✅ **Verify Deployment**

After 1-2 minutes, check if your files are available:

1. **HTML file**: https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/heatmap.html
2. **Icon file**: https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/images/icon.svg
3. **CSS file**: https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/styles/main.css
4. **JS file**: https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/scripts/main.js

---

## 🚀 **Install in MyGeotab**

Once files are deployed, install the add-in:

1. Open MyGeotab
2. Go to **System Settings** → **Add-Ins**
3. Paste this configuration:
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
4. Click **Save**
5. Navigate to **Activity** → **Heat Map**

---

## 📞 **Need Help?**

If you encounter any issues:

1. **Check file paths**: Make sure all files are in the correct `/dist/` folder structure
2. **Verify branch name**: Ensure you're pushing to the correct branch (main or master)
3. **Check GitHub Pages settings**: Make sure GitHub Pages is enabled for your repository
4. **Clear browser cache**: Try accessing URLs in an incognito/private browser window

---

## 🎉 **Success!**

Once deployed, your enhanced Heat Map will include:
- ✅ **EV Data Support**: Battery levels, charging events, battery health visualization
- ✅ **Modern Interface**: Clean design with Inter font and professional styling
- ✅ **Enhanced Reliability**: Better error handling and performance limits
- ✅ **All Original Features**: Location history and exception history visualization
