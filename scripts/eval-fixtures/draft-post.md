# The cache key is the feature

I spent a week making a render cache correct, and the interesting part was not
the cache.

## What was wrong

The key was the URL. Two users with different permissions shared a cached page.
The fix looked obvious: put the user id in the key.

## Why that was not enough

A user's permissions change between requests. A key that carries the id but not
the permissions version keeps serving the old page after a role change. I added
the version to the key and purged on write.

## What it cost

Every write now purges a set of keys rather than one. The purge is best-effort
and reaches one colo, which is a real limit and is written down rather than
hidden.

## What is still open

A cross-colo purge needs an API token this deployment does not hold.
