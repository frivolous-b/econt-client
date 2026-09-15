// Creates a COD waybill in the Demo (sandbox) environment.
// Run: ECONT_USERNAME=... ECONT_PASSWORD=... node examples/create-label.mjs
import { testConnection, createLabel, trackShipment } from '../dist/index.js';

const config = {
  username: process.env.ECONT_USERNAME,
  password: process.env.ECONT_PASSWORD,
  sandbox: true,
};

const conn = await testConnection(config);
if (!conn.success) {
  console.error('Auth failed:', conn.error);
  process.exit(1);
}
console.log('Connected as:', conn.clientName);

const label = await createLabel(config, {
  senderName: 'Демо магазин ЕООД',
  senderPhone: '0888000000',
  senderCity: 'Пловдив',
  senderPostCode: '4000',
  senderStreet: 'ул. Търговска',
  senderNum: '1',
  receiverName: 'Иван Иванов',
  receiverPhone: '0888111111',
  receiverCity: 'София',
  receiverPostCode: '1000',
  receiverStreet: 'бул. Витоша',
  receiverNum: '15',
  receiverOther: 'вх. Б, ет. 3',
  weight: 0.5,
  shipmentDescription: 'Тестова пратка',
  declaredValue: 100,
  isCod: true,
});

if (!label.success) {
  console.error('Label failed:', label.error);
  process.exit(1);
}
console.log('Tracking number:', label.trackingNumber);

const tracking = await trackShipment(config, label.trackingNumber, 'bg');
console.log('Status:', tracking.status);
console.log('Events:', tracking.events);
