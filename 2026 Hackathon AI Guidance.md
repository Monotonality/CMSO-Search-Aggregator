![][image1]

# 2026 Hackathon AI Guidance

Hackathon is an opportunity to explore new ideas for MSI, many of which will include AI-enabled solutions.

We encourage you to be creative, but keep in mind that some uses of AI and AI tools raise greater risks for the company and may even be prohibited. To keep you from spending energy on projects that will be prohibited by law, keep the following in mind:

**Prohibited Uses of AI**

* Biometric-based emotion recognition;  
* Social scoring:  
* Crime prediction regarding an individual;  
* Untargeted scraping to develop facial recognition databases.

**Additional Guidance**

* [GenAI Risk Mitigation Strategies](https://docs.google.com/document/d/1YeZB6tbgmVAxQg-83t3XJOQYOJcuuRX_suDTxhgd_H4/edit?usp=sharing)  
* [Responsible AI & Technology Stewardship](https://batchat.motorolasolutions.com/home/ls/community/responsible-ai-governance/dashboard)  
* [AI Security Framework](https://docs.google.com/document/d/1OP1pHbALf2x5lqGwaDFPuF7-T_8RTRCoKKp7Cu-sqMA/edit?usp=sharing) (Note Section 5.3 "Local Storage Use of AI").

**Temporary approved Local tools for the Hackathon (ie where to get/manage the models)**

* Ollama  
* LMStudio

**Temporary approved SLMs/LLMs for the Hackathon**  
When reviewing SLMs/LLMs for use, please observe the following guidelines.  For questions, please refer to [2026 Hackathon gChat space](https://chat.google.com/room/AAAAMLBmOeU?cls=7).

* ***Allowable Model Families*****:** Llama (Meta), Mistral/Mixtral (Mistral AI), Phi (Microsoft), Gemma (Google).  
* ***Avoid Community Fine-Tuned or Merged Models*****:** Use standard model families listed above.  Avoid fine-tuned, merged, or custom modifications.  These models may increase the risk of privacy, security, or safety risks when used.  
* ***Parameter Size:*** It is recommended you leverage models in the 7B-9B parameter range or less.  Such model sizes will work reasonably well locally on corporate devices per CPU, NPU, RAM, and Hard Disk constraints.

**Prohibited SLMs/LLMs for the Hackathon**

The following AI tools are currently prohibited.  See the [iProtect FAQ](https://docs.google.com/document/d/1OzTJsTHihfF6znFaipCE6NOX0p1AQ6jSYjdqSCCJzGw/edit?usp=sharing) for additional details.

* Qwen  
* OpenClaw  
* Perplexity  
* Otter  
* Fireflies.AI  
* Fellow  
* WorkBeaver  
* DeepSeek  
* Grok  
* Public-facing or consumer versions of AI, such as ChatGPT  
* AI-enabled browsers

**Cleaning up**

The allowance for local SLMs is temporary for the Hackathon only. Teams must be reminded that if their project continues, it must go through the nominal compliance processes ([AI Hub](https://aihub.commandcentral.com/) and [AI Eval](https://aiprojecteval.motorolasolutions.com/)) and they must clean up and shut down the project (to include removing any localized language models that are downloaded to MSI devices when the Hackathon is over.

**Process Flow**  
Here is the flow/steps that shows the end to end “picture”

**Download → Review → Configure → Hack → Cleanup**

Thanks for all you do to create and protect our innovative work.

[image1]: <data:image/png;base64,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>