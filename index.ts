import mongoose from "mongoose";
import "dotenv/config";
import {
  checkLink,
  cleanup,
  convertToWav,
  downloadClip,
  getTranscription,
  transcribeClip,
  videoClipSchema,
} from "./util";

const clipModel = mongoose.model("clips", videoClipSchema);

const markAsFailed = async (clip: any) => {
  // Update db
  return clipModel.updateOne(
    { _id: clip._id },
    {
      $set: {
        failed: true,
      },
    }
  );
};

const main = async () => {
  console.info("Connecting to DB...");
  await mongoose.connect(process.env.MONGO_URI!).catch((e) => {
    console.error(e);
    process.exit(1);
  });
  console.info("Connected to DB.");

  console.info("Convert all CDN links to MEDIA");
  const allClips = await clipModel.find({ id: { $regex: "cdn" } });
  await Promise.all(
    allClips.map(async (clip) => {
      const url = clip.get("id");
      if (url.includes("cdn.discordapp.com")) {
        await clipModel.updateOne(
          { _id: clip._id },
          { $set: { id: url.replace("cdn.discordapp.com", "media.discordapp.net") } }
        );
      }
    })
  );
  console.info("Converted all CDN links to MEDIA");

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
      for (let i = 1; i < result.duplicates.length; i++) {
        await clipModel.deleteOne({ _id: result.duplicates[i] });
      }
    })
  );
  console.info("Duplicates removed.");

  const cursor = await clipModel.find({
    transcription: { $exists: false },
    failed: { $ne: true },
  });

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
      const clipFilePath = await downloadClip(url).catch(async (e: any) => {
        console.error("\t- Failed to download: ", e);
        await markAsFailed(dbClip);
      });
      if (!clipFilePath) continue;
      console.info("\t- Downloaded");

      // Convert to 16kHz WAV file.
      const wavFilePath = await convertToWav(clipFilePath).catch(async (e: any) => {
        console.error("\t- Failed to convert to WAV: ", e);
        await markAsFailed(dbClip);
      });
      if (!wavFilePath) continue;
      console.info("\t- WAV'ed");

      // Transcribe!
      const transcriptionFilePath = await transcribeClip(wavFilePath).catch(async (e: any) => {
        console.error("\t- Failed to transcribe: ", e);
        await markAsFailed(dbClip);
      });
      if (!transcriptionFilePath) continue;
      console.info("\t- Transcribed");

      const transcription = getTranscription(transcriptionFilePath);
      console.info("\t- Transcription Getted");

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
          $unset: { failed: "" },
        }
      );
      console.info("\t- Clip updated");
    } catch (e: any) {
      console.error(e);
    }
  }

  console.info("Cleaning up output directory...");
  cleanup();

  console.info("Done.");
  process.exit(0);
};

// Entry point
main();
