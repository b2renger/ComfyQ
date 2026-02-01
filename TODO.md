
# TODO

startup :
- after npm run dev, the admin can upload a comfyUI workflow.
- parameters are exposed and he can select which ones will be exposed to the user.
- the admin should enter a password to enable him to reschedule or cancel users job when on the user interface.
- after this selection the admin can launch the app for users with the workflow he uploaded and the parameters he decided to expose to users.
- when system is ready, a first job is scheduled with default parameters from the workflow to estimate the average time of generation
- each new generation from users helps to better approximate the generation time for a job, this data is dynamically used to do the scheduling.

on the user interface
- user can schedule a job.
- the can move their scheduled jobs on the timeline and cancel them.
- all jobs on the server and their results can be viewed by any user, but only the author can download, remove or reschdule their jobs
- there is a dashboard with infomation : all users names, possibilty to filter jobs by user
- if a user tries to cancel or reschedule a job that is not his, he should be prompted to enter the admin password that was set on startup -- admin can see all the jobs and can kill them or move them in the queue

- review the code, cleanup everything, comment the code, remove unnecessary configuration files, all configuration should be done each time the server is launched for now.


- check loading of models
  
- check workflows
  - t2i
  - image edit
  - i2v
  - 3D ?
  - text 2 audio
  - qwen multiple angles
- add webcam support in load image (mobile firiedly

--
