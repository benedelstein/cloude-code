
// create a curl command to get the sessions
//  GET /v1/sprites/{name}/exec
// curl -X GET "https://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec" -H "Authorization: Bearer ${SPRITES_API_KEY}"
import "dotenv/config";
const SPRITES_API_KEY = process.env.SPRITES_API_KEY!;
const SPRITE_NAME = process.argv[2] || "test-1768976896129";

const main = async () => {
    const sessions = await fetch(`https://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec`, {
        headers: {
            Authorization: `Bearer ${SPRITES_API_KEY}`,
        },
    });
    const response = await sessions.json() as { sessions: {id: number }[] };
    console.log(response)
    for (const session of response.sessions) {
        const killResponse = await fetch(`https://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec/${session.id}/kill`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${SPRITES_API_KEY}`,
            },
        });
        if (killResponse.ok) {  
            console.log("[SIGINT] killed session", session.id);
        } else {
            console.error("[SIGINT] failed to kill session", session.id, killResponse.statusText);
        }
    }
}

main();