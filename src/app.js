// Discord Bot Controller - Tauri Application Logic
const { invoke } = window.__TAURI__.core;

class DiscordBotController {
  constructor() {
    this.isConnected = false;
    this.selectedChannel = null;
    this.selectedUser = null;
    this.servers = [];
    this.dmUsers = [];

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadSettings();
  }

  setupEventListeners() {
    // Connection
    document.getElementById('connectBtn').addEventListener('click', () => this.connect());

    // Tab switching
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    // Message sending
    document.getElementById('sendSimpleBtn').addEventListener('click', () => this.sendSimpleMessage());
    document.getElementById('sendEmbedBtn').addEventListener('click', () => this.sendEmbedMessage());

    // Embed preview updates
    document.getElementById('embedTitle').addEventListener('input', () => this.updateEmbedPreview());
    document.getElementById('embedDescription').addEventListener('input', () => this.updateEmbedPreview());

    // Color picker
    document.querySelectorAll('.color-option').forEach(option => {
      option.addEventListener('click', (e) => this.selectColor(e.target));
    });

    // User search with better debouncing
    let searchTimeout;
    document.getElementById('userSearch').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();

      if (query.length < 2) {
        document.getElementById('dmsList').innerHTML = '';
        return;
      }

      searchTimeout = setTimeout(() => this.searchUsers(query), 300);
    });

    // Clear search on focus
    document.getElementById('userSearch').addEventListener('focus', (e) => {
      e.target.select();
    });

    // Enter key for sending messages
    document.getElementById('simpleMessage').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        this.sendSimpleMessage();
      }
    });
  }

  loadSettings() {
    const savedUrl = localStorage.getItem('discord_bot_server_url');
    const savedSecret = localStorage.getItem('discord_bot_api_secret');

    if (savedUrl) {
      document.getElementById('serverUrl').value = savedUrl;
    }

    if (savedSecret) {
      document.getElementById('apiSecret').value = savedSecret;
    }
  }

  saveSettings() {
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const apiSecret = document.getElementById('apiSecret').value.trim();

    localStorage.setItem('discord_bot_server_url', serverUrl);
    localStorage.setItem('discord_bot_api_secret', apiSecret);
  }

  async connect() {
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const apiSecret = document.getElementById('apiSecret').value.trim();

    if (!serverUrl || !apiSecret) {
      this.showNotification('Bitte geben Sie Server URL und API Secret ein', 'error');
      return;
    }

    this.updateConnectionStatus('connecting');
    document.getElementById('connectBtn').disabled = true;

    try {
      console.log('Attempting to connect to:', serverUrl);

      // Set API configuration in Tauri backend
      await invoke('set_api_config', {
        serverUrl: serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl,
        apiSecret: apiSecret
      });

      console.log('API config set, testing connection...');

      // Test connection by fetching servers
      const response = await invoke('get_servers');
      console.log('Server response:', response);

      if (response && response.guilds) {
        this.isConnected = true;
        this.servers = response.guilds;
        this.updateConnectionStatus('connected');
        this.renderServers();
        this.saveSettings();
        this.showNotification('Erfolgreich verbunden!', 'success');
      } else {
        throw new Error('Invalid server response');
      }
    } catch (error) {
      this.isConnected = false;
      this.updateConnectionStatus('disconnected');
      this.showNotification(`Verbindungsfehler: ${error}`, 'error');
      console.error('Connection error:', error);
    } finally {
      document.getElementById('connectBtn').disabled = false;
    }
  }

  updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionStatus');
    const text = document.getElementById('connectionText');

    indicator.className = 'status-indicator';

    switch (status) {
      case 'connected':
        indicator.classList.add('connected');
        text.textContent = 'Verbunden';
        break;
      case 'connecting':
        text.textContent = 'Verbinde...';
        break;
      case 'disconnected':
      default:
        text.textContent = 'Nicht verbunden';
        break;
    }
  }

  renderServers() {
    const serversList = document.getElementById('serversList');

    if (this.servers.length === 0) {
      serversList.innerHTML = '<div class="loading">Keine Server gefunden</div>';
      return;
    }

    serversList.innerHTML = this.servers.map(server => `
      <div class="server-item" data-server-id="${server.id}">
        <div class="server-header" onclick="botController.toggleServer('${server.id}')">
          <div class="server-info">
            <div class="server-icon">
              ${server.icon ? `<img src="${server.icon}" alt="${server.name}" style="width: 100%; height: 100%; border-radius: 50%;">` : server.name.charAt(0).toUpperCase()}
            </div>
            <div class="server-details">
              <h3 title="${this.escapeHtml(server.name)}">${this.escapeHtml(server.name)}</h3>
              <p>Server</p>
            </div>
          </div>
          <div class="expand-icon">▶</div>
        </div>
        <div class="channels-list" id="channels-${server.id}">
          <div class="loading">
            <div class="spinner"></div>
            Lade Kanäle...
          </div>
        </div>
      </div>
    `).join('');
  }

  async toggleServer(serverId) {
    const serverElement = document.querySelector(`[data-server-id="${serverId}"]`);
    const isExpanded = serverElement.classList.contains('expanded');

    // Close all other servers
    document.querySelectorAll('.server-item.expanded').forEach(item => {
      item.classList.remove('expanded');
    });

    if (!isExpanded) {
      serverElement.classList.add('expanded');
      await this.loadChannels(serverId);
    }
  }

  async loadChannels(serverId) {
    const channelsContainer = document.getElementById(`channels-${serverId}`);

    try {
      const response = await invoke('get_channels', { serverId });

      if (response && response.channels) {
        channelsContainer.innerHTML = response.channels.map(channel => `
          <div class="channel-item" onclick="botController.selectChannel('${serverId}', '${channel.id}', '${this.escapeHtml(channel.name)}')">
            <span class="channel-icon">#</span>
            <span title="${this.escapeHtml(channel.name)}">${this.escapeHtml(channel.name)}</span>
          </div>
        `).join('');
      } else {
        channelsContainer.innerHTML = '<div class="loading">Keine Kanäle gefunden</div>';
      }
    } catch (error) {
      channelsContainer.innerHTML = `<div class="loading" style="color: var(--error-color);">Fehler beim Laden der Kanäle: ${error}</div>`;
      console.error('Error loading channels:', error);
    }
  }

  selectChannel(serverId, channelId, channelName) {
    // Clear previous selections
    document.querySelectorAll('.channel-item.selected, .dm-user.selected').forEach(item => {
      item.classList.remove('selected');
    });

    // Select new channel
    event.target.closest('.channel-item').classList.add('selected');

    this.selectedChannel = { serverId, channelId, channelName };
    this.selectedUser = null;

    // Update header
    const serverName = this.servers.find(s => s.id === serverId)?.name || 'Unbekannter Server';
    document.getElementById('selectedChannelName').textContent = `# ${channelName}`;
    document.getElementById('selectedChannelDesc').textContent = `${serverName}`;
  }

  async searchUsers(query) {
    if (!this.isConnected) {
      document.getElementById('dmsList').innerHTML = '<div class="loading" style="color: var(--error-color);">Nicht verbunden</div>';
      return;
    }

    // Show loading state
    document.getElementById('dmsList').innerHTML = '<div class="loading"><div class="spinner"></div>Suche Benutzer...</div>';

    try {
      console.log('Searching for users with query:', query);
      const users = await invoke('search_users', { query });
      console.log('Search results:', users);

      if (users && Array.isArray(users)) {
        this.renderDMUsers(users);
      } else {
        console.log('Invalid search response:', users);
        document.getElementById('dmsList').innerHTML = '<div class="loading">Keine Benutzer gefunden</div>';
      }
    } catch (error) {
      console.error('Error searching users:', error);
      document.getElementById('dmsList').innerHTML = `<div class="loading" style="color: var(--error-color);">Fehler bei der Benutzersuche: ${error}</div>`;
    }
  }

  renderDMUsers(users) {
    const dmsList = document.getElementById('dmsList');

    if (users.length === 0) {
      dmsList.innerHTML = '<div class="loading">Keine Benutzer gefunden</div>';
      return;
    }

    dmsList.innerHTML = users.map(user => `
      <div class="dm-user" onclick="botController.selectUser('${user.id}', '${this.escapeHtml(user.username)}', '${this.escapeHtml(user.displayName || user.username)}')">
        <div class="user-avatar">
          ${user.avatar ? `<img src="${user.avatar}" alt="${user.username}" style="width: 100%; height: 100%; border-radius: 50%;">` : (user.username || 'U').charAt(0).toUpperCase()}
        </div>
        <div class="user-info">
          <h3 title="${this.escapeHtml(user.displayName || user.username)}">${this.escapeHtml(user.displayName || user.username)}</h3>
          <p title="@${this.escapeHtml(user.username)}">@${this.escapeHtml(user.username)}</p>
        </div>
      </div>
    `).join('');
  }

  selectUser(userId, username, displayName) {
    // Clear previous selections
    document.querySelectorAll('.channel-item.selected, .dm-user.selected').forEach(item => {
      item.classList.remove('selected');
    });

    // Select new user
    event.target.closest('.dm-user').classList.add('selected');

    this.selectedUser = { userId, username, displayName };
    this.selectedChannel = null;

    // Update header
    document.getElementById('selectedChannelName').textContent = displayName;
    document.getElementById('selectedChannelDesc').textContent = `Direkte Nachricht an @${username}`;
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update content
    document.querySelectorAll('.composer-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`${tabName}Composer`).classList.add('active');
  }

  selectColor(colorElement) {
    document.querySelectorAll('.color-option').forEach(option => {
      option.classList.remove('selected');
    });
    colorElement.classList.add('selected');
    this.updateEmbedPreview();
  }

  updateEmbedPreview() {
    const title = document.getElementById('embedTitle').value || 'Embed Titel';
    const description = document.getElementById('embedDescription').value || 'Embed Beschreibung';

    document.getElementById('previewTitle').textContent = title;
    document.getElementById('previewDescription').textContent = description;

    // Update color
    const selectedColor = document.querySelector('.color-option.selected').dataset.color;
    document.querySelector('.embed-preview').style.borderLeftColor = selectedColor;
  }

  async sendSimpleMessage() {
    const message = document.getElementById('simpleMessage').value.trim();

    if (!message) {
      this.showNotification('Bitte geben Sie eine Nachricht ein', 'error');
      return;
    }

    if (!this.selectedChannel && !this.selectedUser) {
      this.showNotification('Bitte wählen Sie einen Kanal oder Benutzer aus', 'error');
      return;
    }

    if (!this.isConnected) {
      this.showNotification('Nicht mit dem Bot-Server verbunden', 'error');
      return;
    }

    document.getElementById('sendSimpleBtn').disabled = true;

    try {
      await invoke('send_simple_message', {
        channelId: this.selectedChannel?.channelId || null,
        userId: this.selectedUser?.userId || null,
        message: message
      });

      document.getElementById('simpleMessage').value = '';
      this.showNotification('Nachricht erfolgreich gesendet!', 'success');
    } catch (error) {
      this.showNotification(`Fehler beim Senden: ${error}`, 'error');
      console.error('Send message error:', error);
    } finally {
      document.getElementById('sendSimpleBtn').disabled = false;
    }
  }

  async sendEmbedMessage() {
    const title = document.getElementById('embedTitle').value.trim();
    const description = document.getElementById('embedDescription').value.trim();

    if (!title && !description) {
      this.showNotification('Bitte geben Sie mindestens einen Titel oder eine Beschreibung ein', 'error');
      return;
    }

    if (!this.selectedChannel && !this.selectedUser) {
      this.showNotification('Bitte wählen Sie einen Kanal oder Benutzer aus', 'error');
      return;
    }

    if (!this.isConnected) {
      this.showNotification('Nicht mit dem Bot-Server verbunden', 'error');
      return;
    }

    const thumbnailUrl = document.getElementById('embedThumbnail').value.trim();
    const imageUrl = document.getElementById('embedImage').value.trim();
    const footerText = document.getElementById('embedFooter').value.trim();

    const embedData = {
      title: title || null,
      description: description || null,
      color: document.querySelector('.color-option.selected').dataset.color,
      thumbnail: thumbnailUrl ? { url: thumbnailUrl } : null,
      image: imageUrl ? { url: imageUrl } : null,
      footer: footerText ? { text: footerText } : null,
      timestamp: new Date().toISOString()
    };

    document.getElementById('sendEmbedBtn').disabled = true;

    try {
      await invoke('send_embed_message', {
        channelId: this.selectedChannel?.channelId || null,
        userId: this.selectedUser?.userId || null,
        embedData: embedData
      });

      // Clear embed form
      document.getElementById('embedTitle').value = '';
      document.getElementById('embedDescription').value = '';
      document.getElementById('embedThumbnail').value = '';
      document.getElementById('embedImage').value = '';
      document.getElementById('embedFooter').value = '';
      this.updateEmbedPreview();

      this.showNotification('Embed-Nachricht erfolgreich gesendet!', 'success');
    } catch (error) {
      this.showNotification(`Fehler beim Senden: ${error}`, 'error');
      console.error('Send embed error:', error);
    } finally {
      document.getElementById('sendEmbedBtn').disabled = false;
    }
  }

  showNotification(message, type = 'info') {
    // Remove existing notifications
    document.querySelectorAll('.notification').forEach(notification => {
      notification.remove();
    });

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">
        ${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'} 
        ${type === 'success' ? 'Erfolg' : type === 'error' ? 'Fehler' : 'Info'}
      </div>
      <div>${this.escapeHtml(message)}</div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 300);
    }, 5000);
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the application when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  window.botController = new DiscordBotController();
});