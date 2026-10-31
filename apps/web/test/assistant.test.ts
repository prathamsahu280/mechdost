import { describe, expect, it } from 'vitest';
import { detectIntent } from '../src/assistant/intents';
import { staticTransport } from '../src/assistant/transport';

describe('assistant intents', () => {
  it.each([
    ['I need 50 batteries, bulk price please', 'bulk'],
    ['wholesale tyres for my fleet', 'bulk'],
    ['where is my order?', 'track'],
    ['I want a refund', 'track'],
    ['book a service for my Activa', 'workshop'],
    ['need a mechanic near Telibandha', 'workshop'],
    ['price of Exide battery', 'shop'],
    ['I want to sell spare parts on MechDost', 'partner'],
    ['can I talk to someone', 'contact'],
    ['मुझे बल्क में टायर चाहिए', 'bulk'],
    ['बाइक की सर्विस करानी है', 'workshop'],
    ['बैटरी का दाम क्या है', 'shop'],
    ['hello', 'fallback'],
  ])('"%s" → %s', (message, intent) => {
    expect(detectIntent(message)).toBe(intent);
  });

  it('answers the latest user message', async () => {
    const reply = await staticTransport.reply([
      { role: 'user', text: 'tyres' },
      { role: 'assistant', text: '…' },
      { role: 'user', text: 'actually I want to become a partner' },
    ]);
    expect(reply.intent).toBe('partner');
  });
});
