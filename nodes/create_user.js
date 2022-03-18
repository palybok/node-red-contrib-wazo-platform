global.window = global;

module.exports = function (RED) {
  const { WazoApiClient } = require('@wazo/sdk');
  const fetch = require('node-fetch');
  const https = require("https");
  const { v4: uuidv4 } = require('uuid');

  const agent = new https.Agent({
    rejectUnauthorized: false
  });

  function create_user(n) {
    RED.nodes.createNode(this, n);
    this.conn = RED.nodes.getNode(n.server);
    this.client = this.conn.apiClient.confd;
    this.server = `${this.conn.host}:${this.conn.port}`;
    this.context = n.context;

    var node = this;

    node.on('input', async msg => {
      const user = {
        context: node.context || msg.payload.context,
        subscription_type: msg.payload.subscription_type || 0,
        firstname: msg.payload.firstname,
        lastname: msg.payload.lastname,
        extension: msg.payload.extension,
        email: msg.payload.email,
        username: msg.payload.username || msg.payload.email,
        password: msg.payload.password,
        webrtc: msg.payload.webrtc || 0
      }

      try {
        node.status({fill:"blue", shape:"dot", text: `User creation...`});
        const token = await node.conn.authenticate();
        const res_user = await createUser(this.server, token, user);
        user.uuid = res_user.uuid;
        if (user.username) {
          const res_auth_user = await createAuthUser(this.server, token, user);
          msg.payload.data_auth = res_auth_user;
        }
        const res_line = await createLine(this.server, token, user);
        const res_endpoint = await createEndpoint(this.server, token, user);
        const res_exten = await createExtension(this.server, token, user);
        const res_assoc_line_endpoint = await assocLineEndpoint(this.server, token, res_line, res_endpoint);
        const res_assoc_line_exten = await assocLineExten(this.server, token, res_line, res_exten);
        const res_assoc_line_user = await assocLineUser(this.server, token, res_line, res_user);
        node.log(`Create user with ${user.context}`);
        msg.payload.data = res_user;
        msg.payload.data_line = res_line;
        msg.payload.data_endpoint = res_endpoint;
        msg.payload.data_exten = res_exten;
        node.status({});
        node.send(msg);
      }
      catch(err) {
        node.error(err);
        throw err;
      }
    });

  }

  const getWebrtcTemplates = async(server, token, name) => {
    const url = `https://${server}/api/confd/1.1/endpoints/sip/templates?search=webrtc`;
    return requestApi(url, token, null, 'GET');
  };

  const createUser = async (server, token, user) => {
    const url = `https://${server}/api/confd/1.1/users`;
    const payload = {
      subscription_type: user.subscription_type,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email
    };

    return requestApi(url, token, payload);
  };

  const createAuthUser = async (server, token, user) => {
    const url = `https://${server}/api/auth/0.1/users`;
    const payload = {
      uuid: user.uuid,
      firstname: user.firstname,
      lastname: user.lastname,
      username: user.username,
      password: user.password,
      email_address: user.email
    };

    return requestApi(url, token, payload);
  };

  const createLine = async (server, token, user) => {
    const url = `https://${server}/api/confd/1.1/lines`;
    const payload = {
      context: user.context,
      position: 1
    };

    return requestApi(url, token, payload);
  };

  const createEndpoint = async (server, token, user) => {
    const url = `https://${server}/api/confd/1.1/endpoints/sip`;
    const username = uuidv4();
    const password = uuidv4();

    const payload = {
      label: username,
      name: username,
      templates: [],
      auth_section_options: [
        ["username", username],
        ["password", password]
      ]
    };

    if (user.webrtc) {
      const templates = await getWebrtcTemplates(server, token);
      templates.items.map(template => payload.templates.push({ uuid: template.uuid }));
    }

    return requestApi(url, token, payload);
  };

  const createExtension = async (server, token, user) => {
    const url = `https://${server}/api/confd/1.1/extensions`;
    const payload = {
      context: user.context,
      exten: user.extension
    };

    return requestApi(url, token, payload);
  };

  const assocLineEndpoint = async (server, token, line, endpoint) => {
    const url = `https://${server}/api/confd/1.1/lines/${line.id}/endpoints/sip/${endpoint.uuid}`;
    return requestApi(url, token, null, 'PUT');
  };

  const assocLineExten = async (server, token, line, exten) => {
    const url = `https://${server}/api/confd/1.1/lines/${line.id}/extensions/${exten.id}`;
    return requestApi(url, token, null, 'PUT');
  };

  const assocLineUser = async (server, token, line, user) => {
    const url = `https://${server}/api/confd/1.1/users/${user.uuid}/lines/${line.id}`;
    return requestApi(url, token, null, 'PUT');
  };

  const requestApi = async (url, token, payload, method) => {
    const options = {
      method: method || 'POST',
      agent: agent,
      headers: {
        'content-type': 'application/json',
        'X-Auth-Token': token
      }
    };

    if (payload) {
      options.body = JSON.stringify(payload);
    }
    return fetch(url, options).then(response => {
      if (response.status >= 400) {
        return response.statusText;
      }
      else if (response.status >= 200 && response.status < 300) {
        if (options.method == 'PUT' || options.method == 'DELETE') {
          return null;
        }
        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.indexOf('application/json') !== -1;
        return isJson ? response.json() : response.text();
      }
    }).then(data => data);
  };

  RED.nodes.registerType("wazo create user", create_user);

};
