bootsequence
- do a test run on startup to estimate the time it takes to generate an image on the specific machine we are using. We should first run the warmup prompt to load the models, then run the benchmark prompt to estimate the time it takes to generate an image. We should keep the second value as the base time for the scheduler. 

diffusion engine
- fix the rendering issue, something is wrong with image generation (vae ? clip ? wrong model ? cfg ?)


feature dashboard
- in the dashboard, when a user clicks on a user's name, it should display all the jobs for that user.

Expose
- run server with host :  Network: use --host to expose

Cleanup project structure
- move python script to analyse worflow and do the mapping in a specific folder 'pyscripts'

UX
- subcribe to the job advancement from comyUI generation process
- add notification when a job is finished



# Done

image handling
<del>- generation should be prefixed with the name of the user and a timestamp YYYYMMDD_HHMMSS to avoid collisions. The timestamp should be the time the job is scheduled, not the time it is executed. </del>

<del>- fix the image download issue, it should download the image from the server, not from the browser.</del>
