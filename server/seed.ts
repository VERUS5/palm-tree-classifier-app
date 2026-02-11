import { db } from "./db";
import { documents, chunks } from "@shared/schema";
import { eq } from "drizzle-orm";

const knowledgeBase = [
  {
    title: "Khalas Palm",
    category: "Khalas",
    topics: {
      irrigation: "Khalas palms require moderate irrigation. In summer, water 3-4 times a week. In winter, once a week is sufficient. Avoid waterlogging as it can lead to root rot. Drip irrigation systems work best for Khalas palms, delivering water directly to the root zone.",
      harvest: "Harvest Khalas dates when they reach the 'Rutab' stage (half-ripe) for best texture, typically in late summer (August). The fruits should have a golden-amber color and soft, caramel-like consistency. Use sharp pruning shears to cut the entire bunch. Handle carefully to avoid bruising.",
      pests: "Susceptible to Red Palm Weevil (Rhynchophorus ferrugineus). Regular monitoring is essential. Use pheromone traps for early detection. Other common pests include the Dubas bug and lesser date moth. Integrated pest management combining biological controls and targeted pesticides is recommended.",
      soil: "Khalas palms thrive in well-drained sandy loam soils with a pH between 7.0-8.0. They are moderately salt-tolerant. Adding organic compost annually improves soil structure and nutrient availability. Mulching around the base helps retain moisture.",
      nutrition: "Apply NPK fertilizer (15-15-15) three times per year: early spring, mid-summer, and fall. Supplement with micronutrients including iron, zinc, and manganese. Organic fertilizers like composted manure can be applied in winter months.",
      general: "Khalas is one of the most popular premium date varieties in Saudi Arabia and the UAE, known for its golden color and caramel-like taste. The tree can grow up to 20 meters tall and live for over 100 years. It begins producing fruit 4-8 years after planting and reaches full production at 15 years."
    }
  },
  {
    title: "Razeez Palm",
    category: "Razeez",
    topics: {
      irrigation: "Razeez is highly drought-tolerant but produces best with consistent moisture. Deep watering twice a week in summer is recommended. Reduce to once every 10 days in winter. The key is deep, infrequent watering rather than shallow, frequent irrigation.",
      harvest: "Razeez dates are often harvested at the 'Tamr' stage (fully dried) as they have excellent storage capabilities. Harvest typically occurs in September-October. The dates should be dark brown to black in color. They can be left on the tree longer than other varieties without quality loss.",
      pests: "Generally more resistant than other varieties, but watch for Lesser Date Moth (Batrachedra amydraula). Maintain clean ground cover to reduce infestation risks. Scale insects can occasionally be problematic. Regular trunk inspection helps catch issues early.",
      soil: "Razeez palms prefer deep sandy soils with good drainage. They can tolerate slightly alkaline conditions up to pH 8.5. These trees are remarkably adaptable to poor soil conditions compared to other date varieties.",
      nutrition: "Razeez requires less fertilization than Khalas. Apply a balanced fertilizer twice yearly in spring and late summer. Potassium supplementation during fruit development improves date quality and sweetness.",
      general: "Razeez dates are famous for their soft texture and rich flavor. They are often used for making date syrup (Dibs/Molasses) and date paste. The variety is particularly valued in the Al-Qassim region of Saudi Arabia. Trees are vigorous growers and relatively low-maintenance."
    }
  },
  {
    title: "Shishi Palm",
    category: "Shishi",
    topics: {
      irrigation: "Shishi palms prefer sandy soil with good drainage. Water frequently but lightly during the flowering season (March-May). In summer, irrigate 3 times weekly. Reduce watering during the Tamr stage to concentrate sugars in the fruit.",
      harvest: "Harvest season starts mid-season, typically July-August. The fruits have a distinct two-tone color before fully ripening, transitioning from yellow-green to a uniform amber. Harvest when 60-70% of the bunch has ripened for optimal flavor.",
      pests: "Prone to dust mites, especially in dry, hot conditions. Washing bunches with water spray can help reduce mite populations. Also susceptible to the Rhinoceros beetle. Regular pruning of old fronds reduces pest harboring sites.",
      soil: "Shishi palms do best in light sandy soils with moderate fertility. Good drainage is essential as they are more sensitive to waterlogging than Khalas or Razeez. Add sand to heavy clay soils before planting.",
      nutrition: "Apply a complete fertilizer with emphasis on potassium during fruit set. Foliar feeding with micronutrients during the growing season improves fruit quality. Avoid excessive nitrogen which promotes vegetative growth at the expense of fruit production.",
      general: "Shishi is a widely cultivated variety, easily identified by its slightly varying color at the 'Bisar' stage. The dates are medium-sized with a pleasant mild sweetness. Popular in traditional Arabian cuisine and often served with Arabic coffee. The trees are well-suited to the climate of central Saudi Arabia."
    }
  }
];

export async function seedKnowledgeBase() {
  const existingDocs = await db.select().from(documents);
  if (existingDocs.length > 0) {
    console.log("Knowledge base already seeded, skipping...");
    return;
  }

  console.log("Seeding knowledge base...");

  for (const entry of knowledgeBase) {
    const [doc] = await db.insert(documents).values({
      title: entry.title,
      category: entry.category,
      contentType: "text",
      metadata: { source: "original_rag_system" },
    }).returning();

    for (const [topic, content] of Object.entries(entry.topics)) {
      await db.insert(chunks).values({
        documentId: doc.id,
        topic,
        content,
      });
    }
  }

  console.log("Knowledge base seeded successfully!");
}
