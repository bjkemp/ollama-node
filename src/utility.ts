import { GenerateFinalOutput } from "./ollama"

export type GenerateMessage = {
  model: string,
  created_at: string,
  response: string,
  done: boolean
}

export type FinalOutput = {
  messages: GenerateMessage[],
  final: GenerateFinalOutput
}


export type GenerateComplete = {
  model: string,
  created_at: string,
  done: boolean,
  context: number[],
  total_duration: number,
  load_duration: number,
  prompt_eval_count: number,
  prompt_eval_duration: number,
  eval_count: number,
  eval_duration: number
}

export interface RequestOptions {
  hostname: string,
  port: number,
  method: string,
  path: string
}

interface Options {
  seed?: number;
  numa?: boolean;

  // Backend options
  useNUMA?: boolean;

  // Model options
  numCtx?: number;
  numKeep?: number;
  numBatch?: number;
  numGQA?: number;
  numGPU?: number;
  mainGPU?: number;
  lowVRAM?: boolean;
  f16KV?: boolean;
  logitsAll?: boolean;
  vocabOnly?: boolean;
  useMMap?: boolean;
  useMLock?: boolean;
  embeddingOnly?: boolean;
  ropeFrequencyBase?: number;
  ropeFrequencyScale?: number;

  // Predict options
  numPredict?: number;
  topK?: number;
  topP?: number;
  tfsZ?: number;
  typicalP?: number;
  repeatLastN?: number;
  temperature?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  mirostat?: number;
  mirostatTau?: number;
  mirostatEta?: number;
  penalizeNewline?: boolean;
  stop?: string[];

  numThread?: number;
}

type PostTarget = 'generate' | 'create' | 'delete' | 'pull' | 'push' | 'copy' | 'embed'; // | 'show';

type PostInput<T> =
  T extends 'generate' ? { model: string, prompt: string, system: string, template: string, options: Options, context: number[] } :
  T extends 'create' ? { name: string, path: string } :
  T extends 'delete' ? { name: string } :
  T extends 'pull' ? { name: string } :
  T extends 'push' ? { name: string } :
  T extends 'copy' ? { source: string, destination: string } :
  T extends 'embed' ? { model: string, prompt: string } :
  never;

function generateUrl(options: RequestOptions): string {
  return `http://${options.hostname}:${options.port}${options.path}`;
}

export async function requestList(options: RequestOptions) {
  const url = generateUrl(options)

  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Failed with status code: ${response.status}`);
  }

  const reader = response.body?.getReader();
  let chunks: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
  }
  
  const decoder = new TextDecoder();
  const joined = chunks.map(chunk => decoder.decode(chunk)).join('');
  const parsed = JSON.parse(joined);
  return parsed;
}

export async function requestShowInfo(options: RequestOptions, model: string) {
  const url = generateUrl(options)

  const response = await fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: JSON.stringify({ "name": model })
  });

  if (!response.ok) {
    throw new Error(`Failed with status code: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

export function requestDelete(options: RequestOptions, model: string) {
  return new Promise((resolve, reject) => {

    const req = request(options, (response) => {
      // console.log(response);
      const statusCode = response.statusCode || 0;
      if (statusCode < 200 || statusCode > 299) {
        return reject(new Error(`Failed with status code: ${response.statusCode}`));
      }
      const body: string[] = [];

      response.on('data', (chunk: string) => body.push(chunk));
      response.on('end', () => {
        const joined = body.join('');
        const parsed = JSON.parse(joined);
        resolve(parsed)
      });
    });
    req.write('{"name": "' + model + '"}');
    req.on('error', reject);
    req.end();
  })

}

export async function requestPost<P extends PostTarget>(target: P, options: RequestOptions, databody: PostInput<P>): Promise<FinalOutput> {
  const url = generateUrl(options)
  let ollamaStream: string = ''
  let output: string = ''

  let finalOutput: FinalOutput;

  await fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: JSON.stringify(databody)
  })
  .then((response) => {
    const reader = response.body.getReader();
    let chunks = [];
    return new ReadableStream({
      start(controller) {
        return pump();
        function pump() {
          return reader.read().then(({ done, value }) => {
            // When no more data needs to be consumed, close the stream
            if (done) {
              controller.close();
              return;
            }
            // Enqueue the next data chunk into our target stream
            chunks.push(value);
            controller.enqueue(value);
            return pump();
          });
        }
      },
    });
  })
  // Create a new response out of the stream
  .then((stream) => new Response(stream))
  // Read the response as text
  .then((response) => response.text())
  .then((text) => ollamaStream += text )
  .finally(() => {
    // Replace newlines in the string with commas
    let json_text = ollamaStream.replace(/(?:\r\n|\r|\n)/g, ',' + '\n')
    // Trim the trailing comma
    json_text = json_text.slice(0, -2)
    const json = JSON.parse(`[${json_text}]`)

    json.forEach((item: any) => {
      if (item.hasOwnProperty('error')) {
        console.log(`Error: ${item.error}`)
      } else {
        output += item.response
      }
    })

    finalOutput = { messages: json, final: output }
  })
  .catch((err) => console.error(err))

  return finalOutput


  // const response = await fetch(url, {
  //   method: options.method,
  //   headers: {
  //     'Content-Type': 'application/json',
  //     ...options.headers
  //   },
  //   body: JSON.stringify(databody)
  // });

  // if (!response.ok) {
  //   throw new Error(`Failed with status code: ${response.status}`);
  // }

  // const res = await response
  // // const data = await res.body
  // console.log(res)

  // const data = await response.json();
  // let finalOutput: FinalOutput;

  // if (typeof data === 'object' && data !== null) {
  //   if (target === 'embed') {
  //     finalOutput = { messages: [], final: JSON.parse(data.response) };
  //   } else {
  //     const final = data.response;
  //     const messages = []; // You might need to adjust this based on how you want to handle messages
  //     finalOutput = { messages, final };
  //   }
  // } else {
  //   throw new Error('Expected data to be an object, but it was not.');
  // }
}

export function streamingPost<P extends PostTarget>(target: P, options: RequestOptions, databody: PostInput<P>, callback: (chunk: any) => void) {
  const req = request(options, (res) => {
    res.on('data', (chunk: string) => {
      // console.log('in streamingPost');
      // console.log(chunk);
      const chunkStr = chunk.toString();
      const items = chunkStr.split('\n').filter(Boolean);

      for (const item of items) {
        callback(item);
        if (item.includes('error')) {
          console.log(`Error: ${JSON.parse(item).error}`)
        }
      }
    });
    res.on('error', (error) => {
      console.error(`Response error: ${error.message}`);
    })
    res.on('end', () => {

    });
  });

  req.on('error', (error) => {
    console.error(`Request error: ${error.message}`);
  });

  // Send the POST data
  req.write(JSON.stringify(databody));
  req.end();
}


// export async function* streamingGenerate(options: RequestOptions, model: string, prompt: string, system: string, template: string, parameters: string): AsyncGenerator<any, any, unknown> {
//   const body: GenerateMessage[] = [];

//   const req = request(options);
//   req.write(JSON.stringify({ "prompt": prompt, "model": model, "system": system, "template": template, "parameters": parameters }));
//   const response: IncomingMessage = await new Promise((resolve, reject) => {
//     req.on('response', resolve);
//     req.on('error', reject);
//     req.end();
//   });
//   for await (const chunk of response) {
//     body.push(JSON.parse(chunk));
//     yield JSON.parse(chunk);
//   }

// }