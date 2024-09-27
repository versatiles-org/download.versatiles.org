# Project Outline


---

## Overview

| volume       | `nodejs`           | `nginx` | `let's encrypt` |
|--------------|--------------------|---------|-----------------|
| remote_files | rw:`/app/volumes/` | r       | -               |
| local_files  | rw:`/app/volumes/` | r       | -               |
| nginx_conf   | rw:`/app/volumes/` | r       | -               |
| cert         | -                  | r       | rw              |
| logs         | rw:`/app/volumes/` | rw      | rw              |

---

## Install

```shell
wget "https://raw.githubusercontent.com/versatiles-org/download.versatiles.org/main/scripts/install.sh"
sudo bash install.sh
```

---

## **Overview**

This project aims to develop a web-based file download system hosted on a Debian-based virtual machine (VM). The system will list available files from cloud storage, accessed via SSH. To optimize download speeds, the latest file—approximately 50GB and updated every three months—will be downloaded to the VM. Older files will be served directly from the cloud storage. All traffic, including file downloads, HTML content, and webhook triggers, will be routed through NGINX. A Node.js script will handle file synchronization, HTML generation, and NGINX configuration. A secret webhook will trigger updates, and an `.env` file will store configuration settings.

---

## **Key Components**

- **Cloud Storage**: Accessed via SSH and mounted using `sshfs` in read-only mode.
- **Debian VM**: Hosts NGINX, Docker, Node.js, and other necessary tools.
- **Domain**: Used for serving files and HTML content (default: `download.versatiles.org`).
- **Node.js Script**: Manages file synchronization, HTML generation, and NGINX configuration.
- **NGINX**: Serves files, HTML pages, and handles webhook requests.
- **Webhook**: A secret endpoint to trigger file list updates and synchronization.

---

## **Detailed Outline**

### **1. Bash Script: `install.sh`**

**Purpose**: Set up the environment and install all necessary dependencies.

**Steps**:

1. **Install Necessary Tools**:
   - **Node.js and npm**: For running the Node.js script.
   - **sshfs**: To mount the cloud storage.
   - **Docker Compose**: For managing Docker containers.
   - **Git**: To clone the project repository.
   - **Webhook Tool**: To handle incoming webhook requests.

2. **User Setup**:
   - Create a new user named `web`:
     ```bash
     sudo adduser web
     ```
   - Switch to the `web` user for all subsequent operations to enhance security:
     ```bash
     su - web
     ```

3. **Clone Project Repository**:
   - Clone the repository:
     ```bash
     git clone git@github.com:versatiles-org/download.versatiles.org.git
     ```
   - Navigate to the project directory and install Node.js dependencies:
     ```bash
     cd download.versatiles.org
     npm install
     ```

4. **Configure Environment (`.env` File)**:
   - Check for the existence of a `.env` file; if it doesn't exist, create one.
   - Ensure that the following variables are set, using defaults or prompting the user if necessary:
     - `STORAGE_URL`
     - `STORAGE_USERNAME`
     - `STORAGE_PASSWORD`
     - `WEBHOOK_SECRET` (defaults to a randomly generated string)
     - `DOMAIN` (defaults to `download.versatiles.org`)

5. **SSHFS Configuration**:
   - Install `sshfs` if not already installed.
   - Configure `sshfs` in `/etc/fstab` for automatic mounting:
     ```
     sshfs#[STORAGE_USERNAME]@[STORAGE_URL]:/remote/path /local/mount/point fuse defaults,ro,allow_other 0 0
     ```
   - Mount the cloud storage to a designated directory on the VM:
     ```bash
     mkdir -p /local/mount/point
     sudo mount -a
     ```
   - Ensure the mount is read-only to prevent accidental modifications.

6. **Webhook Configuration**:
   - Set up a secure webhook endpoint that includes the `WEBHOOK_SECRET`.
   - Configure the webhook to trigger `npm run start` upon receiving a valid request.

---

### **2. Bash Script: `start.sh`**

**Purpose**: Start all necessary services.

**Steps**:

1. **Start Docker Compose**:
   - Navigate to the project directory and run:
     ```bash
     docker-compose up -d
     ```

2. **Run the Node.js Script**:
   - Execute:
     ```bash
     npm run start
     ```
   - This will synchronize files, generate HTML content, and update NGINX configuration.

---

### **3. Node.js Script**

**Purpose**: Manage file synchronization, HTML generation, and NGINX configuration.

**Steps**:

1. **Pull Latest Repository Changes**:
   - Update the local repository to ensure the script is up-to-date
2. **Update Node Dependencies**:
   - Keep Node.js modules current
3. **Manage Files**:
   - **Hash Generation**:
     - Generate missing hashes (e.g., MD5, SHA256) for files in the remote storage.
     - Store these hashes locally for quick access and inclusion in the HTML file list.
   - **Cleanup**:
     - Identify and delete any local files that are no longer needed to save disk space.
   - **File Download**:
     - Download only the latest file from the cloud storage to the local VM:
       ```javascript
       // Example Node.js code snippet
       const latestFile = getLatestFile(remoteFiles);
       downloadFile(latestFile, localDirectory);
       ```

4. **Generate HTML File List**:
   - Create a user-friendly HTML page that lists all available files, including:
     - File names
     - Sizes
     - Hashes
     - Download links
   - Link the latest file to the local copy on the VM.
   - Link older files to the versions served directly from the cloud storage.

5. **Generate NGINX Configuration**:
   - Create `location` blocks in the NGINX configuration for:
     - **Local Files**:
       ```nginx
       location /downloads/latest/ {
           alias /path/to/local/files/;
       }
       ```
     - **Remote Files**:
       ```nginx
       location /downloads/ {
           proxy_pass http://cloud.storage.url/;
       }
       ```
     - **HTML File List**:
       ```nginx
       location / {
           root /path/to/html/files/;
           index index.html;
       }
       ```
     - **Webhook URL**:
       ```nginx
       location /webhook/SECRET_STRING/ {
           proxy_pass http://localhost:port/;
       }
       ```
   - Apply the new configuration by updating the NGINX config files.

6. **Reload NGINX**:
   - Reload NGINX to apply the new configuration without downtime:
     ```bash
     docker exec [nginx_container_name] nginx -s reload
     ```

---

### **4. Docker Compose**

**Purpose**: Manage services in Docker containers for consistency and isolation.

**Services**:

1. **NGINX**:
   - Serves files, HTML content, and handles webhook requests.
   - Configured to work with SSL certificates provided by Let's Encrypt.

2. **Let's Encrypt (Certbot)**:
   - Automatically obtains and renews SSL certificates.
   - Configured to place certificates in a shared volume accessible by NGINX.

**Volumes**:

- **Remote Files**: Mounted via SSHFS in read-only mode.
- **Local Files**: Directory for the latest downloaded file.
- **SSL Certificates**: Shared volume for certificates generated by Let's Encrypt.
- **NGINX Configuration**: Includes custom configuration files and `location` blocks.
- **Logs**:
  - Centralized logging for NGINX, Let's Encrypt, and Node.js.
  - Logs are stored in volumes and can be rotated or managed as needed.
