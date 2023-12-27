import mongoose, { Schema } from "mongoose";
require("dotenv").config();
import {
  checkLink,
  cleanup,
  convertToWav,
  downloadClip,
  getTranscription,
  transcribeClip,
  videoClipSchema,
} from "./util";

const main = async () => {
  console.info("Connecting to DB...");
  await mongoose.connect(process.env.MONGO_URI!).catch((e) => console.error(e));
  console.info("Connected to DB.");

  const clipModel = mongoose.model("clips", videoClipSchema);

  console.info("Removing duplicate URLs...");
  const results = await clipModel.aggregate([
    {
      $group: {
        _id: "$id",
        count: {
          $sum: 1,
        },
        duplicates: {
          $addToSet: "$_id",
        },
      },
    },
    {
      $match: {
        count: {
          $gt: 1,
        },
      },
    },
  ]);

  await Promise.all(
    results.map(async (result) => {
      await clipModel.deleteOne({ _id: result.duplicates[1] });
    })
  );
  console.info("Duplicates removed.");

  const cursor = await clipModel.find({ transcription: { $exists: false } });

  for (let i = 0; i < cursor.length; i++) {
    const dbClip = cursor[i];
    const url = dbClip.id.replace("cdn.discordapp.com", "media.discordapp.net");
    console.info("Processing clip: ", url);

    try {
      // Test if clip still exists
      const result = await checkLink(url);
      if (result.remove) {
        await clipModel.deleteOne({ id: dbClip.id });
        continue;
      }

      // Download the clip temporarily
      const clipFilePath = await downloadClip(url);
      console.info("\t- Downloaded");

      // Convert to 16kHz WAV file.
      const wavFilePath = await convertToWav(clipFilePath);
      console.info("\t- WAV'ed");

      // Transcribe!
      const transcriptionFilePath = await transcribeClip(wavFilePath);
      console.info("\t- Transcribed");
      const transcription = getTranscription(transcriptionFilePath);
      console.info("\t- Downloaded");
      if (!transcription) continue;

      // Update db
      await clipModel.updateOne(
        { _id: dbClip._id },
        {
          $set: {
            transcription: transcription
              .replace(/(?:\r\n|\r|\n)/g, " ")
              .replace(/\s\s+/g, " ")
              .trim(),
          },
        }
      );
    } catch (e: any) {
      console.error(e);
    }
  }

  console.info("Cleaning up output directory...");
  cleanup();

  console.info("Done.");
  return;
};

main();
``;
