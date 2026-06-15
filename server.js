import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.highwayapi.ai/openai',
});

const TTS_PROVIDER = process.env.TTS_PROVIDER || 'highway';

// Supabase — accepts both plain and NEXT_PUBLIC_ env var names
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const VOICES = {
  highway: {
    female: 'female-chengshu',
    male: 'male-qn-jingying',
  },
  openai: {
    female: 'shimmer',
    male: 'onyx',
  },
};

const READING_DIRECTION = [
  'Read this letter as a thoughtful human.',
  'Use natural pauses.',
  'Do not sound like a narrator or customer service.',
  'Allow small, natural hesitations.',
  'Read as if this letter matters personally to you.',
].join(' ');

const EMOTIONS = {
  neutral: {
    highway: 'neutral',
    openai: 'Read in a calm, reflective, emotionally restrained way.',
  },
  happy: {
    highway: 'happy',
    openai: 'Read with quiet warmth and a gentle sense of affection.',
  },
  sad: {
    highway: 'sad',
    openai: 'Read with subdued wistfulness, without becoming theatrical.',
  },
  surprised: {
    highway: 'surprised',
    openai: 'Read with light brightness and a subtle sense of wonder.',
  },
};

app.post('/api/letters', async (req, res) => {
  const { prompt, reply, recipient } = req.body;
  if (!prompt || !reply || !recipient) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!supabase) {
    return res.status(503).json({ error: 'Storage not configured' });
  }
  const { data, error } = await supabase
    .from('letters')
    .insert({ prompt, reply, recipient })
    .select('id, created_at')
    .single();
  if (error) {
    console.error('Supabase insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save letter' });
  }
  res.json(data);
});

app.get('/api/letters', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Storage not configured' });
  }
  const { data, error } = await supabase
    .from('letters')
    .select('id, created_at, prompt, reply, recipient')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Supabase fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to load letters' });
  }
  res.json(data);
});

app.post('/reply', async (req, res) => {
  const { to, userName, text, voiceRef, language = 'auto', history = [] } = req.body;

  if (!to || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!['auto', 'english', 'chinese'].includes(language)) {
    return res.status(400).json({ error: 'Invalid reply language' });
  }

  const name = userName || 'you';

  // Sanitise history: accept only user/assistant turns, cap at 20 entries, 2000 chars each
  const safeHistory = Array.isArray(history)
    ? history
        .filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.text === 'string')
        .slice(0, 20)
        .map(h => ({ role: h.role, content: String(h.text).slice(0, 2000) }))
    : [];

  const hasHistory = safeHistory.length > 0;

  const languageInstruction = {
    auto: `Determine the main language of the original letter and reply in that language. If it mixes Chinese and English, choose the language that feels most emotionally natural for this particular correspondence. Do not translate the original letter. Preserve every name exactly as written.`,
    english: `Write the entire reply in natural English. Do not translate or alter names. The English should feel like genuine personal correspondence, never AI assistance or therapy language.`,
    chinese: `请用自然、含蓄、有文学感的中文写整封回信。不要写成英文翻译腔，不要改写或翻译任何姓名。语气应像真实而私人的书信，而不是人工智能、客服或心理咨询。`,
  }[language];

  const systemPrompt = `You are ${to}. You have received a handwritten letter from ${name} and you are writing back.${hasHistory ? ' This is an ongoing correspondence — you have already exchanged letters.' : ''}

Write a reply letter in your authentic voice as ${to}. The reply must feel like it genuinely comes from ${to} — not from an AI, not from a therapist, not from a self-help book.

Language:
${languageInstruction}

${voiceRef ? `Here is a sample of how ${to} writes or speaks:\n\n${voiceRef}\n\nUse this as a guide for their tone and voice.` : ''}

Guidelines:
- Write as ${to} would actually write — with their personality, perspective, and way of seeing the world
- Do NOT offer advice, solutions, or therapeutic reassurances
- Avoid phrases like "I hear you", "your feelings are valid", "it takes courage", or any therapy-speak
- Be emotionally present but not clinically supportive
- The letter should feel personal, specific, and real — not generic
- Length: 2–4 short paragraphs
- Do not reference that you are an AI

Return ONLY a JSON object in exactly this format:
{
  "salutation": "An appropriate natural salutation in the selected reply language, preserving ${name} exactly",
  "body": "The body of the letter with paragraph breaks using \\n\\n",
  "signature": "A natural signature in the selected reply language, preserving ${to} exactly"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...safeHistory,
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (!parsed.salutation || !parsed.body || !parsed.signature) {
      throw new Error('Incomplete response from model');
    }

    res.json(parsed);
  } catch (err) {
    console.error('Reply error:', err.message);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

app.post('/api/read-letter', async (req, res) => {
  const { text, voice, emotion = 'neutral' } = req.body;

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Letter text is required' });
  }

  if (!['female', 'male'].includes(voice)) {
    return res.status(400).json({ error: 'Choose a reading voice' });
  }

  if (!Object.hasOwn(EMOTIONS, emotion)) {
    return res.status(400).json({ error: 'Choose a feeling for the reading' });
  }

  if (text.length > 8000) {
    return res.status(400).json({ error: 'This letter is too long to read aloud' });
  }

  try {
    const audio = TTS_PROVIDER === 'openai'
      ? await createOpenAISpeech(text, voice, emotion)
      : await createHighwaySpeech(text, voice, emotion);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.length,
      'Cache-Control': 'no-store',
    });
    res.send(audio);
  } catch (err) {
    console.error('Read-aloud error:', err.message);
    res.status(502).json({
      error: err.publicMessage || 'The reading could not be prepared',
    });
  }
});

async function createHighwaySpeech(text, voice, emotion) {
  const voiceSetting = {
    voice_id: VOICES.highway[voice],
    speed: 0.9,
    vol: 1,
    pitch: 0,
    emotion: EMOTIONS[emotion].highway,
    text_normalization: true,
  };

  const response = await fetch('https://api.highwayapi.ai/v3/minimax-speech-02-hd', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: prepareHighwaySpeechText(text),
      voice_setting: voiceSetting,
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
      stream: false,
      language_boost: 'auto',
      output_format: 'hex',
      voice_modify: {
        intensity: 18,
        timbre: -5,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`HighwayAPI speech request failed (${response.status}): ${detail}`);
    error.publicMessage = getSpeechErrorMessage(response.status, detail);
    throw error;
  }

  const payload = await response.json();
  const audioHex = payload.audio || payload.data?.audio;
  const providerStatus = payload.base_resp || payload.baseResp || payload.data?.base_resp;

  if (!audioHex) {
    const providerMessage =
      providerStatus?.status_msg ||
      providerStatus?.statusMessage ||
      payload.message ||
      payload.error?.message;
    const error = new Error(
      providerMessage
        ? `HighwayAPI speech error: ${providerMessage}`
        : `HighwayAPI returned no audio: ${JSON.stringify(payload).slice(0, 500)}`,
    );
    error.publicMessage = providerMessage
      ? `HighwayAPI could not prepare the reading: ${providerMessage}`
      : 'HighwayAPI returned no audio for this reading.';
    throw error;
  }

  if (/^[0-9a-f]+$/i.test(audioHex) && audioHex.length % 2 === 0) {
    return Buffer.from(audioHex, 'hex');
  }

  try {
    const audio = Buffer.from(audioHex, 'base64');
    if (audio.length > 0) return audio;
  } catch {
    // Fall through to the provider response error below.
  }

  const error = new Error('HighwayAPI returned audio in an unsupported encoding');
  error.publicMessage = 'HighwayAPI returned audio in an unreadable format.';
  throw error;
}

function prepareHighwaySpeechText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '<#0.55#>')
    .replace(/\n/g, '<#0.3#>')
    .replace(/([.!?])\s+/g, '$1<#0.22#>')
    .replace(/([,;:—])\s+/g, '$1<#0.12#>');
}

function getSpeechErrorMessage(status, detail = '') {
  const providerMessage = extractProviderMessage(detail);

  if (status === 401) {
    return providerMessage
      ? `HighwayAPI rejected the loaded API key: ${providerMessage}`
      : 'HighwayAPI rejected the loaded API key. It may be expired, revoked, or different from the key in your dashboard.';
  }
  if (status === 403) {
    return providerMessage
      ? `This HighwayAPI key cannot use speech generation: ${providerMessage}`
      : 'This HighwayAPI key is valid, but it does not have access to the native speech service.';
  }
  if (status === 402) {
    return 'HighwayAPI reports that there are not enough credits for this reading.';
  }
  if (status === 404) {
    return 'The HighwayAPI speech service is not available at the configured endpoint.';
  }
  if (status === 429) {
    return 'The reading service is busy. Please wait a moment and try again.';
  }
  return 'HighwayAPI could not prepare this reading.';
}

function extractProviderMessage(detail) {
  try {
    const payload = JSON.parse(detail);
    return (
      payload.message ||
      payload.error?.message ||
      payload.base_resp?.status_msg ||
      payload.baseResp?.statusMessage ||
      ''
    );
  } catch {
    return '';
  }
}

async function createOpenAISpeech(text, voice, emotion) {
  const apiKey = process.env.OPENAI_TTS_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_TTS_API_KEY is required when TTS_PROVIDER=openai');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
  });

  const response = await client.audio.speech.create({
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: VOICES.openai[voice],
    input: text,
    instructions: `${READING_DIRECTION} ${EMOTIONS[emotion].openai}`,
    response_format: 'mp3',
  });

  return Buffer.from(await response.arrayBuffer());
}

if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`Between Us — http://localhost:${PORT}`);
  });
}

export default app;
