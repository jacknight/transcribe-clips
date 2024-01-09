import { Schema } from "mongoose";
require("dotenv").config();
import fs from "fs";
import { v1 } from "uuid";
import download from "download";
import { exec } from "child_process";
import axios from "axios";

export const videoClipSchema = new Schema({
  id: {
    type: String,
    required: true,
  },
  transcription: {
    type: String,
    required: false,
  },
  failed: {
    type: Boolean,
    required: false,
  },
});

export const checkLink = async (url: string) => {
  const result = { valid: false, remove: false };
  try {
    console.debug("1. Checking URL:", url);
    await axios.get(url.replace("cdn.discordapp.com", "media.discordapp.net"));
    console.debug("2. Successfully GET'ed URL.");
    result.valid = true;
    result.remove = false;
  } catch (e: any) {
    if (e?.response?.status === 404) {
      console.error("Removing url from clips: ", url);
      result.remove = true;
      result.valid = false;
    }
  }
  return result;
};

export const downloadClip = async (url: string) => {
  const fileName = `${__dirname}/output/${v1()}-${url.split("/").pop()}`;
  fs.writeFileSync(fileName, await download(url));
  return fileName;
};

export const convertToWav = async (clipFilePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const dir = exec(
      `ffmpeg -i ${clipFilePath} -acodec pcm_s16le -ac 1 -ar 16000 ${clipFilePath}.wav`,
      (err) => {
        if (err) {
          console.error(err);
        }
      }
    );

    dir.on("exit", (exitCode: number) => {
      if (exitCode) reject("Failed to convert to wav.");
      resolve(`${clipFilePath}.wav`);
    });
  });
};

export const transcribeClip = async (wavFilePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const dir = exec(
      `${__dirname}/whisper.cpp/main -t 16 -m whisper.cpp/models/ggml-large-v3.bin -f ${wavFilePath} -otxt -of ${wavFilePath}`,
      (err) => {
        if (err) {
          console.error(err);
          reject(`Failed to transcribe clip: ${err}`);
        }
      }
    );

    dir.on("exit", function (code) {
      // exit code is code
      if (code > 0) {
        reject(`Failed to transcribe clip: ${code}`);
      } else {
        resolve(`${wavFilePath}.txt`);
      }
    });
  });
};

export const getTranscription = (transcriptionFilePath) => {
  return fs.readFileSync(transcriptionFilePath, "utf8");
};

export const cleanup = () => {
  // Remove everything in output folder
  const outputDir = `${__dirname}/output`;
  const files = fs.readdirSync(outputDir);
  files.forEach((file) => {
    fs.unlinkSync(`${outputDir}/${file}`);
  });
};
