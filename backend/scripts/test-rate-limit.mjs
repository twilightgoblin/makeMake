

const URL = "http://localhost:8080/rooms";

async function run() {
  console.log(`Sending 10 concurrent requests to ${URL}...`);
  console.log(`Expected limit: 5 requests per minute.`);
  
  const requests = Array.from({ length: 10 }).map((_, i) => 
    fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: `User ${i}` })
    })
  );
  
  const responses = await Promise.all(requests);
  
  let successCount = 0;
  let rateLimitedCount = 0;
  
  for (const res of responses) {
    if (res.status === 201) {
      successCount++;
    } else if (res.status === 429) {
      rateLimitedCount++;
    } else {
      console.log(`Unexpected status: ${res.status}`);
    }
  }
  
  console.log(`\nResults:`);
  console.log(`Success (201): ${successCount}`);
  console.log(`Rate Limited (429): ${rateLimitedCount}`);
  
  if (successCount === 5 && rateLimitedCount === 5) {
    console.log(`\n✅ Distributed rate limiting works correctly (5 allowed, 5 rejected)!`);
    process.exit(0);
  } else {
    console.error(`\n❌ Failed. Expected 5 success, 5 rejected. Got ${successCount} success, ${rateLimitedCount} rejected.`);
    process.exit(1);
  }
}

run().catch(console.error);
