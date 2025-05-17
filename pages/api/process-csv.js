import formidable from 'formidable';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const parseForm = (req) => {
  const form = new formidable.IncomingForm({ keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
};

async function manageStorageQuota() {
  const { data, error } = await supabase.storage.from('challan-files').list('', {
    limit: 1000,
    sortBy: { column: 'created_at', order: 'asc' },
  });

  if (error || !data) return;

  let totalSize = data.reduce((sum, file) => sum + (file.metadata?.size || 0), 0);
  const sizeLimit = 1 * 1024 * 1024 * 1024; // 1 GB
  const deleteTarget = 200 * 1024 * 1024; // 200 MB

  let deletedSize = 0;
  for (let file of data) {
    if (totalSize - deletedSize <= sizeLimit - deleteTarget) break;
    const path = `${file.name}`;
    await supabase.storage.from('challan-files').remove([path]);
    deletedSize += file.metadata?.size || 0;
  }
}

export default async function handler(req, res) {
  try {
    await manageStorageQuota();

    const { files } = await parseForm(req);
    const file = files.file;
    if (!file || !file.filepath) return res.status(400).json({ error: 'No file uploaded' });

    const inputBuffer = fs.readFileSync(file.filepath);
    const inputRecords = parse(inputBuffer.toString(), { columns: true });

    const txnId = Date.now().toString();
    const inputPath = `inputs/input_${txnId}.csv`;
    const outputPath = `outputs/output_${txnId}.csv`;

    const { error: inputError } = await supabase.storage.from('challan-files').upload(inputPath, inputBuffer, {
      contentType: 'text/csv',
      upsert: true,
    });

    if (inputError) {
      console.error("❌ Failed to upload input file:", inputError);
      return res.status(500).json({ error: 'Failed to upload input file' });
    }

    const inputUrl = supabase.storage.from('challan-files').getPublicUrl(inputPath).data.publicUrl;

    const results = [];

    // --- START: Dynamic IP Management ---
    let effectiveIp = '14.142.186.142'; // fallback

    async function fetchCurrentIp() {
      try {
        const ipCheck = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipCheck.json();
        if (ipData?.ip) {
          console.log("🌐 Updated outbound IP:", ipData.ip);
          return ipData.ip;
        }
      } catch (err) {
        console.warn("⚠️ Failed to fetch outbound IP. Using fallback IP.");
      }
      return effectiveIp;
    }

    effectiveIp = await fetchCurrentIp();

    for (let i = 0; i < inputRecords.length; i++) {
      const row = inputRecords[i];
      const vehicle_number = row.vehicle_number;

      const makeRequest = async (ip) => {
        return await fetch('https://api.instantpay.in/identity/vehicleChallan', {
          method: 'POST',
          headers: {
            'X-Ipay-Auth-Code': '1',
            'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
            'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
            'X-Ipay-Endpoint-Ip': ip,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            vehicleRegistrationNumber: vehicle_number,
            consent: 'Y',
            latitude: '11.1019',
            longitude: '26.9109',
            externalRef: txnId + '-' + i,
          }),
        });
      };

      let response = await makeRequest(effectiveIp);

      if (!response.ok) {
        console.warn(`⚠️ API failed for ${vehicle_number}. Retrying with refreshed IP...`);
        effectiveIp = await fetchCurrentIp();
        response = await makeRequest(effectiveIp);
      }

      if (!response.ok) {
        console.error(`❌ API retry failed for ${vehicle_number}. Skipping.`);
        continue;
      }

      const data = await response.json();
      console.log(`📡 API response for ${vehicle_number}:`, JSON.stringify(data));

      const challans = data?.data?.vehicalData || [];
      for (const ch of challans) {
        results.push({
          vehicle_number,
          challan_number: ch.challanNumber,
          challan_date: ch.challanDate,
          status: ch.challanStatus,
          amount: ch.challanAmount,
          offences: (ch.offences || []).map(o => o.offenceName).join('; '),
        });
      }
    }
    // --- END: Dynamic IP Management ---

    const outputCSV = stringify(results, { header: true });

    const { error: outputError } = await supabase.storage.from('challan-files').upload(outputPath, outputCSV, {
      contentType: 'text/csv',
      upsert: true,
    });

    if (outputError) {
      console.error("❌ Failed to upload output file:", outputError);
      return res.status(500).json({ error: 'Failed to upload output file' });
    }

    const outputUrl = supabase.storage.from('challan-files').getPublicUrl(outputPath).data.publicUrl;
    console.log("✅ Output file uploaded:", outputUrl);

    const { error: insertError } = await supabase.from('transactions').insert([
      {
        input_file_url: inputUrl,
        input_count: inputRecords.length,
        output_file_url: outputUrl,
        output_count: results.length,
        status: results.length > 0 ? 'success' : 'no results',
      },
    ]);

    if (insertError) {
      console.error("❌ Failed to insert transaction:", insertError);
    }

    res.status(200).json({ downloadUrl: outputUrl });
  } catch (err) {
    console.error('🔥 Unexpected Error:', err);
    res.status(500).json({ error: err.message });
  }
}
