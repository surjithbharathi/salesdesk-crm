class Salesdesk {
  constructor() {
    this.description = {
      displayName: 'Salesdesk CRM', name: 'salesdesk', group: ['transform'], version: 1,
      description: 'Import leads, sync follow-up tasks and attach notes with replay protection', defaults: { name: 'Salesdesk CRM' },
      inputs: ['main'], outputs: ['main'], credentials: [{ name: 'salesdeskApi', required: true }],
      properties: [
        { displayName: 'Operation', name: 'operation', type: 'options', default: 'list', options: [
          { name: 'List Leads', value: 'list' }, { name: 'Create Lead (No Retry Protection)', value: 'create' },
          { name: 'Import Lead (Retry Safe)', value: 'ingest' }, { name: 'List Tasks', value: 'tasksList' },
          { name: 'Import Follow-Up Task', value: 'tasks' }, { name: 'Attach Note', value: 'notes' } ] },
        { displayName: 'Lead JSON', name: 'lead', type: 'json', default: '{"name":"","phone":""}', displayOptions: { show: { operation: ['create'] } } },
        { displayName: 'Offset', name: 'offset', type: 'number', default: 0, displayOptions: { show: { operation: ['list'] } } },
        { displayName: 'Task Offset', name: 'taskOffset', type: 'number', default: 0, displayOptions: { show: { operation: ['tasksList'] } } },
        { displayName: 'Mapped Import JSON', name: 'payload', type: 'json', default: '{"source":"n8n","externalId":"","lead":{"name":""}}', description: 'Use source + stable externalId and lead/task fields, or leadId + text for a note. Never include provider credentials.', displayOptions: { show: { operation: ['ingest', 'tasks', 'notes'] } } },
      ],
    };
  }
  async execute() {
    const credentials = await this.getCredentials('salesdeskApi');
    const base = new URL(credentials.url);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('Use the HTTPS CRM origin only');
    const output = [];
    for (let i = 0; i < this.getInputData().length; i++) {
      const operation = this.getNodeParameter('operation', i);
      const routes = { list: ['leads', 'GET'], create: ['leads', 'POST'], ingest: ['ingest', 'POST'], tasksList: ['tasks', 'GET'], tasks: ['tasks', 'POST'], notes: ['notes', 'POST'] };
      if (!routes[operation]) throw Error('Unknown Salesdesk operation');
      const [resource, method] = routes[operation];
      const options = { url: base.origin + '/integrations/v1/' + resource, method, json: true, disableFollowRedirect: true, timeout: 30000 };
      if (method === 'POST') {
        const raw = this.getNodeParameter(operation === 'create' ? 'lead' : 'payload', i);
        options.body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!options.body || typeof options.body !== 'object' || Array.isArray(options.body)) throw Error('JSON object required');
      } else options.qs = { offset: this.getNodeParameter(operation === 'list' ? 'offset' : 'taskOffset', i), limit: 100 };
      const response = await this.helpers.httpRequestWithAuthentication.call(this, 'salesdeskApi', options);
      output.push({ json: response, pairedItem: { item: i } });
    }
    return [output];
  }
}
module.exports = { Salesdesk };
