import { describe, expect, it } from "vitest";
import { classifyJobPrograms } from "./job-program-classifier";

describe("job program classifier", () => {
  it.each([
    "2027 Software Intern",
    "2027 Summer Interns - Data Science",
    "2027 Product Internship",
    "2027 Technology Internships",
    "2027 ML Intern/Co-op",
    "2027 Working Student, Data Analytics",
    "2027 Student Worker - Artificial Intelligence",
    "2027 Industrial Placement - Data Science",
    "2027 Placement Student, Machine Learning",
    "2027 Year in Industry - Analytics",
    "2027 Sandwich Placement - Data",
    "2027 Summer Analyst - Data Science",
    "2027 Summer Associate - AI Strategy",
    "2027 Vacation Scheme - Technology",
    "2027 Vacationer Program - Data",
    "2027 Summer Clerk - Technology",
    "2027 Technology Cadetship",
    "2027 Industrial Attachment - Analytics",
    "2027 Student Researcher - Machine Learning",
    "2027 Student Trainee - Data Science",
    "2027 Industrial Trainee - Artificial Intelligence",
    "2027 Data Science Traineeship",
    "2027 Summer Student - Machine Learning",
    "2027 Vacation Employment - Data Analytics",
    "2027 Work Experience Placement - Data",
    "2027 Work-Integrated Learning - Analytics",
    "2027 Professional Experience Year - AI",
    "2027 Industry Based Learning - Data",
    "2027 Student Work Placement Program - Data",
    "2027 Accounting Articleship",
    "2027 Data Science Externship",
    "2027 Werkstudent Data Science",
    "2027 Praktikum Data & AI",
    "2027 Praktikant Machine Learning",
    "2027 Stagiaire Data Scientist",
    "2027 Alternance - Intelligence Artificielle",
    "Stage Ingénieur traitement de données F/H",
    "Data Scientist - Stage",
    "Machine Learning Engineer (Stage)",
    "2027 Stagiair Data Science",
    "2027 Stagiu Data Science",
    "Afstudeerstage Data Science",
    "2027 Estágio em Ciência de Dados",
    "2027 Estagiário de Analytics",
    "2027 Practicante de Data Science",
    "2027 Prácticas de Inteligencia Artificial",
    "2027 Pasantía Data Analytics",
    "2027 Pasante Data Analytics",
    "2027 Becaria de Datos",
    "2027 Tirocinio Data Science",
    "2027 Stagista AI",
    "2027 Staż Data Science",
    "2027 Praktykant Data Science",
    "2027 Harjoittelija Data Science",
    "2027 Stajyer Data Science",
    "2027 Gyakornok Data Science",
    "2027 Стажёр Data Science",
    "2027 Стажировка Data Science",
    "2027 Praksa Data Science",
    "2027 Πρακτική Άσκηση Data Science",
    "2027 Magang Data Science",
    "2027 Thực tập sinh Data Science",
    "2027 ฝึกงาน Data Science",
    "2027 インターン Data Science",
    "2027 인턴 데이터 사이언스",
    "2027 实习生 - 人工智能",
    "2027 實習 - Data Science",
  ])("classifies internship title: %s", (title) => {
    expect(classifyJobPrograms(title).keys).toContain("internship");
  });

  it.each([
    "2027 Engineering Co-op",
    "2027 Engineering Co Op",
    "2027 Engineering Coop",
    "2027 Engineering Co‑Op",
    "2027 Cooperative Education Student",
    "2027 Co-operative Education Student",
    "2027 Cooperative Work Term Student",
    "2027 Work Term Student - Data Science",
  ])("classifies co-op title: %s", (title) => {
    expect(classifyJobPrograms(title).keys).toContain("coop");
  });

  it.each([
    "2027 Internal Audit Analyst",
    "2027 International Data Analyst",
    "2027 Internals Engineer",
    "Wind Farm Technician - Coopers Gap",
    "Stage Manager",
    "Stage Hand",
    "Early Stage AI Engineer",
    "Stage Production Manager",
    "Management Trainee - Data",
    "Early - Stage AI Engineer",
    "HYCO Operator",
    "Specialist - Talent Acquisition – Early Talent & Intern Recruiting",
    "Campus Recruiter - Internship Program Hiring",
    "Intern Program Coordinator",
    "Nurse Extern Renal PRN",
    "Radiology Tech Extern 1",
    "Student Nurse Extern - Emergency Department",
    "Pharmacy Extern - Inpatient",
  ])("does not classify false positive: %s", (title) => {
    expect(classifyJobPrograms(title).keys).toEqual([]);
  });

  it("keeps a non-clinical externship classified", () => {
    expect(classifyJobPrograms("2027 Data Science Externship").keys).toEqual(["internship"]);
  });

  it("keeps an actual talent acquisition intern classified", () => {
    expect(classifyJobPrograms("2027 Talent Acquisition Intern").keys).toEqual(["internship"]);
  });

  it("can attach both internship and co-op memberships to one title", () => {
    expect(classifyJobPrograms("2027 Machine Learning Intern / Co-op").keys).toEqual(["internship", "coop"]);
  });
});
