class SalesdeskApi {
  constructor() {
    this.name = 'salesdeskApi';
    this.displayName = 'Salesdesk workspace API';
    this.properties = [
      { displayName: 'CRM URL', name: 'url', type: 'string', default: '', required: true },
      { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true },
    ];
    this.authenticate = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };
  }
}
module.exports = { SalesdeskApi };
