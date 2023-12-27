import mongoose, { ConnectOptions, Schema, mongo } from "mongoose";
require("dotenv").config();
import fs from "fs";
import { v1 } from "uuid";
import download from "download";
const path = require("path");
import { exec } from "child_process";
import axios from "axios";

export const videoClipSchema = new Schema({
  id: String,
  transcription: String,
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
      `whisper.cpp/main -t 16 -m whisper.cpp/models/ggml-large-v3.bin -f ${wavFilePath} -otxt -of ${wavFilePath}`,
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

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!).catch((e) => console.error(e));
  const clipModel = mongoose.model("clips", videoClipSchema);
  const clips = await clipModel.find({});

  for (let i = 0; i < clips.length; i++) {
    const clipFileName = await downloadClip(clips[i].id);
    if (!clipFileName) continue;
    const audioFileName = await convertToWav(clipFileName).catch((e: any) => console.error(e));
    if (!audioFileName) continue;
    const txtFileName = await transcribeClip(audioFileName).catch((e: any) => console.error(e));
    if (!txtFileName) continue;
    const jsonObj = {
      videoFile: clipFileName,
      audioFile: audioFileName,
      txtFile: txtFileName,
      url: clips[i].id,
    };

    const jsonFileName = `${clipFileName}.json`;
    if (fs.existsSync(jsonFileName)) {
      fs.readFile(jsonFileName, "utf8", (err, data) => {
        if (err) {
          console.error(err);
        } else {
          const temp = JSON.parse(data);
          temp.data.push(jsonObj);
          fs.writeFileSync(jsonFileName, JSON.stringify(temp), "utf8");
        }
      });
    } else {
      fs.writeFileSync(jsonFileName, JSON.stringify({ data: [jsonObj] }), "utf8");
    }
  }

  return;
};
