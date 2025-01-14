global.window = global;

module.exports = function(RED) {
  const { internalHTTP } = require('./lib/internal_api.js');
  const { WazoApiClient, WazoWebSocketClient } = require('@wazo/sdk');
  const fetch = require('node-fetch');
  const https = require("https");
  const ws = require("ws");

  WazoWebSocketClient.eventLists.push('fax_outbound_created');
  WazoWebSocketClient.eventLists.push('fax_outbound_succeeded');
  WazoWebSocketClient.eventLists.push('fax_outbound_failed');
  WazoWebSocketClient.eventLists.push('queue_log');
  WazoWebSocketClient.eventLists.push('queue_caller_abandon');
  WazoWebSocketClient.eventLists.push('queue_caller_join');
  WazoWebSocketClient.eventLists.push('queue_caller_leave');
  WazoWebSocketClient.eventLists.push('queue_member_added');
  WazoWebSocketClient.eventLists.push('queue_member_pause');
  WazoWebSocketClient.eventLists.push('queue_member_penalty');
  WazoWebSocketClient.eventLists.push('queue_member_removed');
  WazoWebSocketClient.eventLists.push('queue_member_ringinuse');
  WazoWebSocketClient.eventLists.push('queue_member_status');
  WazoWebSocketClient.eventLists.push('stt');
  WazoWebSocketClient.eventLists.push('user_created');
  WazoWebSocketClient.eventLists.push('user_deleted');
  WazoWebSocketClient.eventLists.push('user_edited');
  WazoWebSocketClient.eventLists.push('call_push_notification');

  const agent = new https.Agent({
    rejectUnauthorized: false
  });

  function config(n) {
    RED.nodes.createNode(this, n);
    this.host = n.host;
    this.port = n.port;
    this.debug = n.debug;
    this.expiration = n.expiration;
    this.refreshToken = n.refreshToken;
    this.insecure = true;
    this.token = false;
    this.sessionUuid = false;

    var node = this;

    this.apiClient = new WazoApiClient({
      server: `${this.host}:${this.port}`,
      agent: agent,
      clientId: 'wazo-nodered'
    });

    this.authenticate = async () => {
      try {
        const check = await node.apiClient.auth.checkToken(node.token);
        if (check !== true) {
          node.log(`Connection to ${node.host} to get a valid token`);
          const auth = await node.apiClient.auth.refreshToken(node.refreshToken, null, node.expiration);
          node.token = auth.token;
          node.sessionUuid = auth.sessionUuid;
          node.apiClient.setToken(auth.token);
          node.apiClient.setRefreshToken(node.refreshToken);
        }
        return node.token;
      }
      catch(err) {
        node.error(err);
        throw err;
      }
    };

    node.setMaxListeners(0);
    const websocket = createClient(node);
  }

  const createClient = async (node) => {
    node.log(`Create websocket on ${node.host}`);
    if (node.insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
    }

    const token = await node.authenticate();
    const wsClient = new WazoWebSocketClient({
      host: node.host,
      token: token,
      events: ['*'],
      version: 2
    }, {
        WebSocket: ws,
        debug: node.debug
    });

    node.apiClient.setOnRefreshToken((token) => {
      wsClient.updateToken(token);
      node.apiClient.setToken(token);
      node.log('Refresh Token refreshed');
    });

    WazoWebSocketClient.eventLists.map(event => wsClient.on(event, (message) => {
      if (event == 'auth_session_expire_soon') {
        if (message.data.uuid == node.sessionUuid) {
          node.log('Session will expire, force Refresh Token');
          node.apiClient.forceRefreshToken();
        }
      }

      const msg = {
        topic: event,
        tenant_uuid: message.tenant_uuid,
        origin_uuid: message.origin_uuid,
        required_acl: message.required_acl,
        payload: message.data
      };

      node.emit('onmessage', msg);
      node.emit(msg.topic, msg);

    }));

    wsClient.on('onopen', () => {
      node.emit('onopen');
    });

    wsClient.on('initialized', () => {
      node.emit('initialized');
    });

    wsClient.on('onclose', (err) => {
      node.emit('onclosed', err);
    });

    wsClient.on('onerror', (err) => {
      node.emit('onerror', err);
    });

    node.on('close', async (done) => {
      console.log('close websocket');
      wsClient.close();
      done();
    });

    try {
      wsClient.connect();
      return wsClient;
    }
    catch(err) {
      node.error(err);
      throw err;
    }
  };

  RED.nodes.registerType("wazo config", config);

  // REGISTER ALL HTTP INTERNAL ENDPOINT

  RED.httpAdmin.post('/wazo-platform/auth', async (req, res) => {
    apiClient = new WazoApiClient({
      server: `${req.body.host}:${req.body.port}`,
      agent: agent,
      clientId: 'wazo-nodered'
    });

    try {
      const { refreshToken, ...result } = await this.apiClient.auth.logIn({
        username: req.body.username,
        password: req.body.password,
        expiration: req.body.expiration
      });

      res.send(refreshToken);
    }
    catch(err) {
      res.send(err);
      throw err;
    }
  });

  RED.httpAdmin.get("/wazo-platform/lib/*", (req, res) => {
    var options = {
      root: __dirname + '/lib/',
      dotfiles: 'deny'
    };
    res.sendFile(req.params[0], options);
  });

  RED.httpAdmin.post('/wazo-platform/users', async (req, res) => {
    await internalHTTP(req, res, 'api/confd/1.1/users', 'listUsers')
  });

  RED.httpAdmin.post('/wazo-platform/contexts', async (req, res) => {
    await internalHTTP(req, res, 'api/confd/1.1/contexts', 'listContexts')
  });

  RED.httpAdmin.post('/wazo-platform/tenants', async (req, res) => {
    await internalHTTP(req, res, 'api/auth/0.1/tenants', 'listTenants')
  });

  RED.httpAdmin.post('/wazo-platform/moh', async (req, res) => {
    await internalHTTP(req, res, 'api/confd/1.1/moh', 'listMoh')
  });

  RED.httpAdmin.post('/wazo-platform/voicemails', async (req, res) => {
    await internalHTTP(req, res, 'api/confd/1.1/voicemails', 'listVoicemails')
  });

  RED.httpAdmin.post('/wazo-platform/applications', async (req, res) => {
    await internalHTTP(req, res, 'api/confd/1.1/applications', 'listApplications')
  });

  RED.httpAdmin.post('/wazo-platform/get-refresh', async (req, res) => {
    await internalHTTP(req, res, 'api/auth/0.1/users/me/tokens', 'listRefreshToken')
  });

  RED.httpAdmin.post('/wazo-platform/trunks', async (req, res) => {
    await internalHTTP(req, res, 'api/confd/1.1/trunks', 'listTrunks')
  });

  RED.httpAdmin.get('/wazo-platform/service', (req, res) => {
    const services = [
      'agentd',
      'auth',
      'calld',
      'call-logd',
      'chatd',
      'confd',
      'dird',
      'provd',
      'webhookd',
    ];
    res.json(services);
  });

  RED.httpAdmin.get('/wazo-platform/events', (req, res) => {
    res.json(WazoWebSocketClient.eventLists);
  });
};
