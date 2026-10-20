import 'dotenv/config';
import { buildApp } from './api';

const port = Number(process.env.PORT ?? 3000);

const app = buildApp();

app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`KiBrain API listening at ${address}`);
});
